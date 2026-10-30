import { useState } from 'react';
import { useStore } from '../lib/store';
import { activePlayer, primaryPlan } from '../lib/reducer';
import { formatDate } from '../lib/i18n';
import type { Drill } from '../types';
import { Button, Field, inputCls, Modal } from './ui';

export function AddToSession({ drill, open, onClose }: { drill: Drill; open: boolean; onClose: () => void }) {
  const { state, dispatch, t, lang, toast } = useStore();
  const player = activePlayer(state);
  const plan = player ? primaryPlan(state, player.id) : undefined;
  const sessions = plan?.sessions.filter((s) => s.status === 'planned') ?? [];
  const [sessionId, setSessionId] = useState(sessions[0]?.id ?? '');
  const [reason, setReason] = useState('');
  const target = sessions.find((s) => s.id === sessionId);
  const already = !!target?.items.some((i) => i.drillId === drill.id);

  return (
    <Modal open={open} onClose={onClose} title={t('addToSession')}>
      {!plan || !sessions.length ? (
        <p className="text-sm text-muted">{t('noUpcoming')}</p>
      ) : (
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!target) return;
            if (already) {
              toast(t('alreadyInSession', { n: target.index }), 'warn');
              return;
            }
            dispatch({ type: 'addSessionItem', planId: plan.id, sessionId: target.id, drillId: drill.id, reason: reason.trim() || drill.objective });
            toast(t('addedToSession', { n: target.index }));
            setReason('');
            onClose();
          }}
        >
          <p className="text-sm">
            <strong>{drill.name}</strong>
          </p>
          <Field label={t('selectSession')} htmlFor="ats-session">
            <select id="ats-session" className={inputCls} value={sessionId} onChange={(e) => setSessionId(e.target.value)}>
              {sessions.map((s) => (
                <option key={s.id} value={s.id}>
                  {t('session')} {s.index} · {formatDate(lang, s.date)} · {s.title}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('whyDrill')} hint={drill.objective} htmlFor="ats-reason">
            <textarea id="ats-reason" rows={2} className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={drill.objective} />
          </Field>
          {already && <p className="text-sm font-semibold text-warn">{t('alreadyInSession', { n: target?.index ?? '' })}</p>}
          <div className="flex justify-end gap-2">
            <Button onClick={onClose}>{t('cancel')}</Button>
            <Button type="submit" variant="primary" disabled={already}>
              {t('add')}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
