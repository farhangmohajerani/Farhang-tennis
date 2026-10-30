import { useState, type ReactNode } from 'react';
import { useStore } from '../lib/store';
import { href } from '../lib/router';
import { ROLES, type Role } from '../types';
import { roleKey, type DictKey } from '../lib/i18n';
import { activePlayer } from '../lib/reducer';
import { cx, Icon, Toasts } from './ui';
import { PlayersModal } from './Players';
import { getTeam } from '../lib/team';

export const NAV: { name: string; key: DictKey; roles: Role[] }[] = [
  { name: 'dashboard', key: 'nav_dashboard', roles: ['parent', 'coach', 'admin'] },
  { name: 'library', key: 'nav_library', roles: ['parent', 'coach', 'admin'] },
  { name: 'planner', key: 'nav_planner', roles: ['coach', 'admin'] },
  { name: 'session', key: 'nav_session', roles: ['coach', 'admin'] },
  { name: 'parent', key: 'nav_parent', roles: ['parent', 'coach', 'admin'] },
  { name: 'progress', key: 'nav_progress', roles: ['parent', 'coach', 'admin'] },
  { name: 'admin', key: 'nav_admin', roles: ['admin'] },
];

export function Layout({ route, children }: { route: string; children: ReactNode }) {
  const { state, dispatch, t, lang, adapter, saveStatus, saveError } = useStore();
  const role = state.settings.role;
  const player = activePlayer(state);
  const items = NAV.filter((n) => n.roles.includes(role));
  const activeName = route === 'drill' ? 'library' : route;
  const [playersOpen, setPlayersOpen] = useState(false);
  const rank: Record<Role, number> = { parent: 0, coach: 1, admin: 2 };
  const roles = ROLES.filter((r) => !adapter.maxRole || rank[r] <= rank[adapter.maxRole]);
  const canManage = role !== 'parent' && adapter.canWrite !== false;
  const shared = adapter.kind === 'artifact';

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <header className="sticky z-30 bg-band text-band-ink" style={{ top: 'env(safe-area-inset-top, 0px)' }}>
        <div className="gutter mx-auto flex max-w-6xl items-center gap-3 py-2.5">
          <a href={href('dashboard')} className="flex min-w-0 items-center gap-2" aria-label={t('appName')}>
            <Icon.court className="h-7 w-7 shrink-0 text-accent" />
            <span className="truncate font-display text-[22px] leading-none tracking-tight">{t('appName')}</span>
          </a>
          <div className="ms-auto flex items-center gap-2">
            <label className="sr-only" htmlFor="role-select">{t('role')}</label>
            <select
              id="role-select"
              value={role}
              onChange={(e) => dispatch({ type: 'setRole', role: e.target.value as Role })}
              className="h-8 rounded-full border border-band-muted/40 bg-transparent px-2 text-[13px] font-semibold text-band-ink"
              style={{ fontSize: 13 }}
            >
              {roles.map((r) => (
                <option key={r} value={r} className="bg-band">
                  {t(roleKey(r))}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => dispatch({ type: 'setLang', lang: lang === 'en' ? 'fa' : 'en' })}
              className="h-8 rounded-full border border-band-muted/40 px-3 text-[13px] font-semibold"
              aria-label={t('language')}
              data-testid="lang-toggle"
            >
              {lang === 'en' ? 'فا' : 'EN'}
            </button>
          </div>
        </div>
        <nav className="hidden border-t border-band-muted/20 md:block" aria-label="Main">
          <ul className="gutter mx-auto flex max-w-6xl gap-1 py-1.5">
            {items.map((n) => (
              <li key={n.name}>
                <a
                  href={href(n.name)}
                  className={cx('block rounded-full px-3.5 py-1.5 text-sm font-semibold', activeName === n.name ? 'bg-accent text-accent-ink' : 'text-band-muted hover:text-band-ink')}
                  aria-current={activeName === n.name ? 'page' : undefined}
                >
                  {t(n.key)}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </header>

      {(player || canManage) && (
        <div className="border-b border-line bg-surface">
          <div className="gutter mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-1 py-2 text-[13px]">
            <span className="eyebrow">{t('player')}</span>
            {state.players.length > 1 ? (
              <select
                id="player-select"
                aria-label={t('player')}
                value={state.settings.activePlayerId}
                onChange={(e) => dispatch({ type: 'setActivePlayer', id: e.target.value })}
                className="h-8 max-w-[50vw] rounded-full border border-line bg-surface px-2 font-semibold"
                style={{ fontSize: 13 }}
              >
                {state.players.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            ) : (
              <strong className="font-semibold">{player?.name ?? '—'}</strong>
            )}
            {player && (
              <span className="text-muted">
                {t('age', { n: new Date().getFullYear() - player.birthYear })} · {player.hand === 'right' ? 'RH' : 'LH'} · {player.backhand === 'two' ? '2HBH' : '1HBH'}
              </span>
            )}
            {canManage && (
              <button type="button" className="font-semibold text-accent" onClick={() => setPlayersOpen(true)} data-testid="manage-players">
                {t('managePlayers')}
              </button>
            )}
            <span className={cx('ms-auto rounded-full px-2 py-0.5 text-[11px] font-bold', shared ? 'bg-good-soft text-good' : 'bg-warn-soft text-warn')} title={adapter.label}>
              {shared ? t('sharedBadge') : adapter.kind === 'supabase' ? 'Supabase' : t('demoBanner')}
            </span>
          </div>
        </div>
      )}
      {playersOpen && <PlayersModal open={playersOpen} onClose={() => setPlayersOpen(false)} />}

      <main className="gutter mx-auto w-full max-w-6xl flex-1 pb-28 md:pb-12">{children}</main>

      <footer className="gutter mx-auto w-full max-w-6xl pb-28 text-[12px] text-muted md:pb-8">
        <div className="court-rule mb-3" />
        <p>
          <strong>{t('storage')}:</strong> {adapter.label}.{' '}
          <span data-testid="save-status">
            {saveStatus === 'saving' && '…'}
            {saveStatus === 'saved' && `✓ ${t('saved')}`}
            {saveStatus === 'error' && <span className="text-bad">{t('syncError', { msg: saveError ?? '' })}</span>}
          </span>
                  {getTeam() && (
            <span className="ms-2 inline-flex flex-wrap items-center gap-2">
              · {t('signedInAs', { email: getTeam()!.myEmail })}
              <button type="button" className="font-semibold text-accent" onClick={() => getTeam()!.signOut()} data-testid="sign-out">
                {t('signOutBtn')}
              </button>
            </span>
          )}
</p>
      </footer>

      <nav
        className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface md:hidden"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)', paddingLeft: 'env(safe-area-inset-left, 0px)', paddingRight: 'env(safe-area-inset-right, 0px)' }}
        aria-label="Main mobile"
      >
        <ul className="flex">
          {items.map((n) => (
            <li key={n.name} className="min-w-0 flex-1">
              <a
                href={href(n.name)}
                className={cx('flex h-14 flex-col items-center justify-center px-0.5 text-center text-[10.5px] font-semibold leading-tight', activeName === n.name ? 'text-accent' : 'text-muted')}
                aria-current={activeName === n.name ? 'page' : undefined}
              >
                <span className={cx('mb-1 h-1 w-6 rounded-full', activeName === n.name ? 'bg-accent' : 'bg-transparent')} />
                {t(n.key)}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      <Toasts />
    </div>
  );
}
