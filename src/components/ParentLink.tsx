/**
 * Connecting a parent to a child with a 6-digit code (see lib/pairing.ts), in either direction:
 *  - "Connect parents" (coach): type the code shown on the parent's screen, or make a code for the parent.
 *  - "Connect coach" (parent): type the code the coach made for the child, or show their own code.
 */
import { useEffect, useState } from 'react';
import { useStore } from '../lib/store';
import { formatDate } from '../lib/i18n';
import { getPairing, isMissingFunction, type Invite } from '../lib/pairing';
import type { Player } from '../types';
import { Button, ConfirmButton, cx, Field, inputCls, Modal } from './ui';

type T = ReturnType<typeof useStore>['t'];
const digits = (v: string) => v.replace(/\D/g, '').slice(0, 6);
const appUrl = () => `${window.location.origin}${window.location.pathname}`;

/* ---------------- Parent side ---------------- */

/** This parent's own code (the coach types it under "Connect parents"). */
function useMyCode() {
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
  return { code, failed, pairing };
}

function redeemMessage(error: string, t: T) {
  if (error === 'invalid_code') return t('coachCodeInvalid');
  if (error === 'too_many_attempts') return t('coachCodeTooMany');
  if (error === 'staff_account') return t('coachCodeStaff');
  return t('inviteFailed');
}

/** Parent: type the code the coach made for the child. */
function CoachCodeForm({ onDone }: { onDone?: () => void }) {
  const { t, toast } = useStore();
  const pairing = getPairing();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; bad: boolean } | null>(null);
  const submit = async () => {
    if (!pairing?.redeem) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await pairing.redeem(code.trim());
      if ('error' in r) return setMsg({ text: redeemMessage(r.error, t), bad: true });
      setCode('');
      setMsg({ text: t('coachConnected', { name: r.name }), bad: false });
      toast(t('coachConnected', { name: r.name }));
      onDone?.();
    } catch (e) {
      setMsg({ text: isMissingFunction(e) ? t('inviteUnavailable') : t('inviteFailed'), bad: true });
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="flex flex-col gap-2"
      data-testid="coach-code-form"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="flex gap-2">
        <input
          id="coach-code"
          data-autofocus
          inputMode="numeric"
          autoComplete="off"
          dir="ltr"
          placeholder="······"
          aria-label={t('coachCodeLabel')}
          className={cx(inputCls, 'h-12 min-w-0 flex-1 text-center font-mono text-2xl tracking-[0.3em]')}
          value={code}
          onChange={(e) => setCode(digits(e.target.value))}
        />
        <Button type="submit" variant="primary" className="h-12 px-5" disabled={code.length !== 6 || busy} data-testid="coach-code-submit">
          {busy ? '…' : t('connectParent')}
        </Button>
      </div>
      {msg && (
        <p className={cx('text-sm font-semibold', msg.bad ? 'text-bad' : 'text-good')} role={msg.bad ? 'alert' : 'status'} data-testid="coach-code-msg">
          {msg.text}
        </p>
      )}
    </form>
  );
}

/** Shown to a parent: connect with the coach's code, or give the coach this code. */
export function ParentConnect({ compact }: { compact?: boolean }) {
  const { t } = useStore();
  const { code, failed, pairing } = useMyCode();
  const canRedeem = !!pairing?.redeem;
  return (
    <div className={cx('rounded-2xl border border-line bg-surface', compact ? 'p-4' : 'p-6')} data-testid="parent-connect">
      <h2 className="font-display text-2xl">{t('connectTitle')}</h2>
      {canRedeem && (
        <div className="mt-3 max-w-md">
          <h3 className="text-[15px] font-semibold">🔗 {t('connectCoachBtn')}</h3>
          <p className="mb-2 text-sm text-muted">{t('haveCoachCodeHelp')}</p>
          <CoachCodeForm />
        </div>
      )}
      <div className={cx(canRedeem && 'mt-5 border-t border-line pt-4')}>
        {canRedeem && <h3 className="text-[15px] font-semibold">{t('orGiveYourCode')}</h3>}
        <p className="mt-1 max-w-[60ch] text-sm text-muted">{pairing && !pairing.needsOpenPage ? t('connectHelpAnytime') : t('connectHelp')}</p>
        <div className="num mt-4 min-h-[48px] font-mono text-[40px] font-medium tracking-[0.25em]" data-testid="pair-code" dir="ltr">
          {code ?? (failed ? '' : '······')}
        </div>
        {failed && <p className="mt-2 text-[13px] font-semibold text-warn">{t('connectUnavailable')}</p>}
      </div>
    </div>
  );
}

/** Parent, from the top bar: add a child (or reconnect) with the coach's code. */
export function ConnectCoachModal({ onClose }: { onClose: () => void }) {
  const { t } = useStore();
  const { code } = useMyCode();
  return (
    <Modal open onClose={onClose} title={t('connectCoachTitle')}>
      <div className="flex flex-col gap-3" data-testid="connect-coach-modal">
        <p className="text-sm text-muted">{t('haveCoachCodeHelp')}</p>
        <CoachCodeForm onDone={() => window.setTimeout(onClose, 1500)} />
        <div className="mt-2 border-t border-line pt-4">
          <h3 className="text-[15px] font-semibold">{t('orGiveYourCode')}</h3>
          <div className="num mt-2 font-mono text-[32px] font-medium tracking-[0.25em]" dir="ltr" data-testid="my-pair-code">
            {code ?? '······'}
          </div>
        </div>
      </div>
    </Modal>
  );
}

/* ---------------- Coach side ---------------- */

/** The parents linked to one player, connecting a new one by code, removing one. */
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

  /** Resolves the parent's code and links that parent to the player. True when connected. */
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

/** Coach: a code for this player that the parent types under "Connect coach". */
function InvitePanel({ player }: { player: Player }) {
  const { t, lang, toast } = useStore();
  const pairing = getPairing();
  const [inv, setInv] = useState<Invite | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const load = async (fresh: boolean) => {
    if (!pairing?.invite) return;
    setBusy(true);
    setErr('');
    try {
      setInv(await pairing.invite(player.id, fresh));
      if (fresh) toast(t('inviteNewDone'));
    } catch (e) {
      setInv(null);
      setErr(isMissingFunction(e) ? t('inviteUnavailable') : t('inviteFailed'));
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    setInv(null);
    void load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player.id]);
  const text = inv ? t('inviteShareText', { name: player.name, code: inv.code, url: appUrl() }) : '';
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast(t('inviteCopied'));
    } catch {
      toast(t('inviteCopyFailed'), 'warn');
    }
  };
  return (
    <div className="flex flex-col items-center gap-2 text-center" data-testid="invite-panel">
      <p className="text-sm text-muted">{t('inviteHelp', { name: player.name })}</p>
      <div className="num mt-1 min-h-[52px] font-mono text-[44px] font-medium tracking-[0.25em]" dir="ltr" data-testid="invite-code">
        {inv?.code ?? (err ? '' : '······')}
      </div>
      {inv && <p className="text-[13px] text-muted">{t('inviteValid', { date: formatDate(lang, inv.expiresAt.slice(0, 10), { day: 'numeric', month: 'long' }) })}</p>}
      {err && (
        <p className="text-sm font-semibold text-bad" role="alert" data-testid="invite-error">
          {err}
        </p>
      )}
      <div className="mt-1 flex flex-wrap justify-center gap-2">
        {canShare && (
          <Button variant="primary" disabled={!inv} onClick={() => void navigator.share({ text }).catch(() => undefined)} data-testid="invite-share">
            {t('inviteShare')}
          </Button>
        )}
        <Button disabled={!inv} onClick={() => void copy()} data-testid="invite-copy">
          {t('inviteCopy')}
        </Button>
        {inv && !busy && <ConfirmButton label={t('inviteNew')} confirmLabel={t('inviteNewConfirm')} variant="ghost" size="md" onConfirm={() => void load(true)} />}
      </div>
    </div>
  );
}

/** Coach/admin: the one place to connect a parent — type the parent's code, or make a code for the parent. */
export function ConnectParentModal({ onClose }: { onClose: () => void }) {
  const { state, t } = useStore();
  const pairing = getPairing();
  const canInvite = !!pairing?.invite;
  const [tab, setTab] = useState<'enter' | 'invite'>('enter');
  const [playerId, setPlayerId] = useState(state.settings.activePlayerId || state.players[0]?.id || '');
  const player = state.players.find((p) => p.id === playerId) ?? state.players[0];
  const { ids, names, busy, connect, remove } = useParentLinks(player);
  const [code, setCode] = useState('');
  const tabs: { k: 'enter' | 'invite'; label: string }[] = [
    { k: 'enter', label: t('tabParentCode') },
    { k: 'invite', label: t('tabCodeForParent') },
  ];
  return (
    <Modal open onClose={onClose} title={t('connectParentTitle')}>
      <div className="flex flex-col gap-4" data-testid="connect-parent-modal">
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
        {canInvite && (
          <div className="grid grid-cols-2 gap-1 rounded-full bg-sunken p-1" role="tablist">
            {tabs.map((x) => (
              <button
                key={x.k}
                type="button"
                role="tab"
                aria-selected={tab === x.k}
                className={cx('h-10 rounded-full text-sm font-semibold', tab === x.k ? 'bg-surface text-ink shadow-sm' : 'text-muted')}
                onClick={() => setTab(x.k)}
                data-testid={`tab-${x.k}`}
              >
                {x.label}
              </button>
            ))}
          </div>
        )}
        {tab === 'enter' || !canInvite ? (
          <form
            className="flex flex-col gap-4"
            onSubmit={async (e) => {
              e.preventDefault();
              if (await connect(code)) setCode('');
            }}
          >
            <p className="text-sm text-muted">{t('connectParentHelp')}</p>
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
            <Button type="submit" variant="primary" className="h-12 text-base" disabled={code.length !== 6 || busy || !player} data-testid="connect-parent-submit">
              {busy ? '…' : t('connectParent')}
            </Button>
          </form>
        ) : (
          player && <InvitePanel player={player} />
        )}
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
