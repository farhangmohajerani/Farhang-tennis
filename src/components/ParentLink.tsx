/**
 * Connecting a parent to a child, inside claude.ai.
 * The parent opens the shared page (as a Viewer) and sees a 6-digit code; the coach types that
 * code while the parent's page is open. The platform tells the coach's page who is showing the
 * code (their claude.ai id), and the coach links that id to the player. Nothing secret travels:
 * the code only finds the right open page, and the platform, not the page, vouches for the id.
 */
import { useEffect, useState } from 'react';
import { useStore } from '../lib/store';
import type { Player } from '../types';
import { Button, cx, inputCls } from './ui';

type Use = (n: string) => Promise<unknown>;
const claudeUse = (): Use | null => {
  const c = (window as unknown as { claude?: { use?: Use } }).claude;
  return c && typeof c.use === 'function' ? c.use.bind(c) : null;
};
interface Peer { by: string | null; isMe: boolean; kind: string; presence: Record<string, unknown> }
interface Room { presence(p: Record<string, unknown>): Promise<void>; peers(): readonly Peer[] }
interface UserNs { profiles(ids: string[]): Promise<Record<string, { name: string }>> }

const CODE_KEY = 'tennis-progress:pair-code';
function pairCode(): string {
  try {
    const old = window.sessionStorage.getItem(CODE_KEY);
    if (old) return old;
  } catch {
    /* ignore */
  }
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  const code = String(100000 + (a[0] % 900000));
  try {
    window.sessionStorage.setItem(CODE_KEY, code);
  } catch {
    /* ignore */
  }
  return code;
}

/** Shown to a parent: their connection code. */
export function ParentConnect({ compact }: { compact?: boolean }) {
  const { t } = useStore();
  const [code] = useState(pairCode);
  const [live, setLive] = useState<boolean | null>(null);
  useEffect(() => {
    const use = claudeUse();
    if (!use) return setLive(false);
    let alive = true;
    (use('room') as Promise<Room | null>)
      .then((room) => {
        if (!alive) return;
        if (!room) return setLive(false);
        setLive(true);
        void room.presence({ pair: code }).catch(() => undefined);
      })
      .catch(() => setLive(false));
    return () => {
      alive = false;
    };
  }, [code]);
  return (
    <div className={cx('rounded-2xl border border-line bg-surface', compact ? 'p-4' : 'p-6')} data-testid="parent-connect">
      <h2 className="font-display text-2xl">{t('connectTitle')}</h2>
      <p className="mt-1 max-w-[60ch] text-sm text-muted">{t('connectHelp')}</p>
      <div className="num mt-4 font-mono text-[40px] font-medium tracking-[0.25em]" data-testid="pair-code" dir="ltr">
        {code}
      </div>
      {live === false && <p className="mt-2 text-[13px] font-semibold text-warn">{t('connectUnavailable')}</p>}
    </div>
  );
}

/** Coach side, per player: linked parents + "connect with code". */
export function ParentLinks({ player }: { player: Player }) {
  const { dispatch, t, toast } = useStore();
  const [code, setCode] = useState('');
  const [names, setNames] = useState<Record<string, string>>({});
  const ids = player.parentIds ?? [];
  const idsKey = ids.join(',');
  useEffect(() => {
    const use = claudeUse();
    if (!use || !ids.length) return;
    (use('user') as Promise<UserNs | null>).then((u) => u?.profiles(ids).then((ps) => setNames(Object.fromEntries(ids.map((id) => [id, ps[id]?.name || ''])))));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);

  const connect = async () => {
    const use = claudeUse();
    const room = use ? ((await use('room').catch(() => null)) as Room | null) : null;
    if (!room) return toast(t('connectUnavailable'), 'error');
    const peer = room.peers().find((p) => p.kind === 'viewer' && !p.isMe && p.by && p.presence?.pair === code.trim());
    if (!peer?.by) return toast(t('codeNotFound'), 'warn');
    if (ids.includes(peer.by)) return toast(t('parentAlready'), 'warn');
    dispatch({ type: 'upsertPlayer', player: { ...player, parentIds: [...ids, peer.by] } });
    setCode('');
    toast(t('parentConnected', { name: player.name }));
  };

  return (
    <div className="mt-2 rounded-xl bg-sunken p-3" data-testid={`parent-links-${player.id}`}>
      <div className="eyebrow mb-1">{t('parentsFollowing')}</div>
      {ids.length === 0 && <p className="text-[13px] text-muted">{t('noParentsYet')}</p>}
      <ul className="flex flex-col gap-1">
        {ids.map((id, i) => (
          <li key={id} className="flex items-center gap-2 text-sm">
            <span className="min-w-0 flex-1 truncate">{names[id] || `${t('role_parent')} ${i + 1}`}</span>
            <Button
              size="sm"
              variant="danger"
              onClick={() => {
                dispatch({ type: 'upsertPlayer', player: { ...player, parentIds: ids.filter((x) => x !== id) } });
                toast(t('parentRemoved'));
              }}
            >
              {t('remove')}
            </Button>
          </li>
        ))}
      </ul>
      <form
        className="mt-2 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void connect();
        }}
      >
        <input
          id={`pair-${player.id}`}
          inputMode="numeric"
          maxLength={6}
          placeholder={t('codePlaceholder')}
          aria-label={t('codePlaceholder')}
          className={cx(inputCls, 'font-mono')}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
        />
        <Button type="submit" variant="primary" disabled={code.length !== 6} data-testid={`connect-parent-${player.id}`}>
          {t('connectParent')}
        </Button>
      </form>
    </div>
  );
}
