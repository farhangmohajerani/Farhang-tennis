/**
 * Connecting a parent to a child with a 6-digit code (see lib/pairing.ts for how the code
 * is issued and resolved on claude.ai and on Supabase).
 */
import { useEffect, useState } from 'react';
import { useStore } from '../lib/store';
import { getPairing } from '../lib/pairing';
import type { Player } from '../types';
import { Button, cx, inputCls } from './ui';

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

/** Coach side, per player: linked parents + "connect with code". */
export function ParentLinks({ player }: { player: Player }) {
  const { dispatch, t, toast } = useStore();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [names, setNames] = useState<Record<string, string>>({});
  const ids = player.parentIds ?? [];
  const idsKey = ids.join(',');
  const pairing = getPairing();
  useEffect(() => {
    if (!pairing || !ids.length) return;
    pairing.names(ids).then(setNames).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey, pairing]);

  const connect = async () => {
    if (!pairing) return toast(t('connectUnavailable'), 'error');
    setBusy(true);
    try {
      const id = await pairing.resolve(code.trim());
      if (!id) return toast(pairing.needsOpenPage ? t('codeNotFound') : t('codeNotFoundAnytime'), 'warn');
      if (ids.includes(id)) return toast(t('parentAlready'), 'warn');
      dispatch({ type: 'upsertPlayer', player: { ...player, parentIds: [...ids, id] } });
      setCode('');
      toast(t('parentConnected', { name: player.name }));
    } catch {
      toast(t('connectUnavailable'), 'error');
    } finally {
      setBusy(false);
    }
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
        <Button type="submit" variant="primary" disabled={code.length !== 6 || busy} data-testid={`connect-parent-${player.id}`}>
          {t('connectParent')}
        </Button>
      </form>
    </div>
  );
}
