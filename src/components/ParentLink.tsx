/**
 * Connecting a parent to a child with a 6-digit code (see lib/pairing.ts for how the code
 * is issued and resolved on claude.ai and on Supabase).
 */
import { useEffect, useState } from 'react';
import { useStore } from '../lib/store';
import { getPairing } from '../lib/pairing';
import type { Player } from '../types';
import { Button, cx, Field, inputCls, Modal } from './ui';

/** Shown to a parent: their connection code. */
export function ParentConnect({ compact }: { compact?: boolean }) {
  const { t } = useStore();
  const [code, setCode] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const pairing = getPairing();
  useEffect(() => {
    let alive = true;
    if (!pairing) return setFailed(true);
    pairing
      .myCode()
      .then((c) => {
        if (!alive) return;
        if (c) setCode(c);
        else setFailed(true);
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [pairing]);
  return (
    <div className={cx('rounded-2xl border border-line bg-surface', compact ? 'p-4' : 'p-6')} data-testid="parent-connect">
      <h2 className="font-display text-2xl">{t('connectTitle')}</h2>
      <p className="mt-1 max-w-[60ch] text-sm text-muted">{pairing && !pairing.needsOpenPage ? t('connectHelpAnytime') : t('connectHelp')}</p>
      <div className="num mt-4 min-h-[48px] font-mono text-[40px] font-medium tracking-[0.25em]" data-testid="pair-code" dir="ltr">
        {code ?? (failed ? '' : '······')}
      </div>
      {failed && <p className="mt-2 text-[13px] font-semibold text-warn">{t('connectUnavailable')}</p>}
    </div>
  );
}

/** Coach side: the parents linked to one player, connecting a new one by code, removing one. */
function useParentLinks(player: Player | undefined) {
  const { dispatch, t, toast } = useStore();
  const [busy, setBusy] = useState(false);
  const [names, setNames] = useState<Record<string, string>>({});
  const ids = player?.parentIds ?? [];
  const idsKey = ids.join(',');
  const pairing = getPairing();
  useEffect(() => {
    if (!pairing || !ids.length) return;
    let alive = true;
    pairing
      .names(ids)
      .then((n) => alive && setNames(n))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey, pairing]);

  /** Resolves the code and links that parent to the player. True when connected. */
  const connect = async (code: string): Promise<boolean> => {
    if (!player) return false;
    if (!pairing) {
      toast(t('connectUnavailable'), 'error');
      return false;
    }
    setBusy(true);
    try {
      const id = await pairing.resolve(code.trim());
      if (!id) {
        toast(pairing.needsOpenPage ? t('codeNotFound') : t('codeNotFoundAnytime'), 'warn');
        return false;
      }
      if (ids.includes(id)) {
        toast(t('parentAlready'), 'warn');
        return false;
      }
      dispatch({ type: 'upsertPlayer', player: { ...player, parentIds: [...ids, id] } });
      toast(t('parentConnected', { name: player.name }));
      return true;
    } catch {
      toast(t('connectUnavailable'), 'error');
      return false;
    } finally {
      setBusy(false);
    }
  };
  const remove = (id: string) => {
    if (!player) return;
    dispatch({ type: 'upsertPlayer', player: { ...player, parentIds: ids.filter((x) => x !== id) } });
    toast(t('parentRemoved'));
  };
  return { ids, names, busy, connect, remove };
}

function ParentList({ ids, names, onRemove }: { ids: string[]; names: Record<string, string>; onRemove: (id: string) => void }) {
  const { t } = useStore();
  if (!ids.length) return <p className="text-[13px] text-muted">{t('noParentsYet')}</p>;
  return (
    <ul className="flex flex-col gap-1" data-testid="parent-list">
      {ids.map((id, i) => (
        <li key={id} className="flex items-center gap-2 text-sm">
          <span className="min-w-0 flex-1 truncate">{names[id] || `${t('role_parent')} ${i + 1}`}</span>
          <Button size="sm" variant="danger" onClick={() => onRemove(id)}>
            {t('remove')}
          </Button>
        </li>
      ))}
    </ul>
  );
}

const digits = (v: string) => v.replace(/\D/g, '').slice(0, 6);

/** Coach side, per player inside "Manage players": linked parents + "connect with code". */
export function ParentLinks({ player }: { player: Player }) {
  const { t } = useStore();
  const { ids, names, busy, connect, remove } = useParentLinks(player);
  const [code, setCode] = useState('');
  return (
    <div className="mt-2 rounded-xl bg-sunken p-3" data-testid={`parent-links-${player.id}`}>
      <div className="eyebrow mb-1">{t('parentsFollowing')}</div>
      <ParentList ids={ids} names={names} onRemove={remove} />
      <form
        className="mt-2 flex gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (await connect(code)) setCode('');
        }}
      >
        <input
          id={`pair-${player.id}`}
          inputMode="numeric"
          autoComplete="off"
          placeholder={t('codePlaceholder')}
          aria-label={t('codePlaceholder')}
          className={cx(inputCls, 'font-mono')}
          value={code}
          onChange={(e) => setCode(digits(e.target.value))}
        />
        <Button type="submit" variant="primary" disabled={code.length !== 6 || busy} data-testid={`connect-parent-${player.id}`}>
          {t('connectParent')}
        </Button>
      </form>
    </div>
  );
}

/** Coach/admin: the one obvious place to type the code a parent sees after signing up. */
export function ConnectParentModal({ onClose }: { onClose: () => void }) {
  const { state, t } = useStore();
  const [playerId, setPlayerId] = useState(state.settings.activePlayerId || state.players[0]?.id || '');
  const player = state.players.find((p) => p.id === playerId) ?? state.players[0];
  const { ids, names, busy, connect, remove } = useParentLinks(player);
  const [code, setCode] = useState('');
  return (
    <Modal open onClose={onClose} title={t('connectParentTitle')}>
      <div className="flex flex-col gap-4" data-testid="connect-parent-modal">
        <p className="text-sm text-muted">{t('connectParentHelp')}</p>
        <form
          className="flex flex-col gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await connect(code)) setCode('');
          }}
        >
          <Field label={t('codePlaceholder')} htmlFor="connect-code">
            <input
              id="connect-code"
              data-autofocus
              inputMode="numeric"
              autoComplete="off"
              dir="ltr"
              placeholder="······"
              className={cx(inputCls, 'h-14 text-center font-mono text-3xl tracking-[0.3em]')}
              value={code}
              onChange={(e) => setCode(digits(e.target.value))}
            />
          </Field>
          {state.players.length > 1 ? (
            <Field label={t('connectForPlayer')} htmlFor="connect-player">
              <select id="connect-player" className={inputCls} value={player?.id ?? ''} onChange={(e) => setPlayerId(e.target.value)}>
                {state.players.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </Field>
          ) : (
            <p className="text-sm">
              {t('connectForPlayer')}: <strong>{player?.name ?? '—'}</strong>
            </p>
          )}
          <Button type="submit" variant="primary" className="h-12 text-base" disabled={code.length !== 6 || busy || !player} data-testid="connect-parent-submit">
            {busy ? '…' : t('connectParent')}
          </Button>
        </form>
        {player && (
          <div className="rounded-xl bg-sunken p-3">
            <div className="eyebrow mb-1">
              {t('parentsFollowing')} · <span className="normal-case">{player.name}</span>
            </div>
            <ParentList ids={ids} names={names} onRemove={remove} />
          </div>
        )}
      </div>
    </Modal>
  );
}
