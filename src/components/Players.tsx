import { useState } from 'react';
import { useStore } from '../lib/store';
import { LEVELS, type Player } from '../types';
import { levelLabel } from '../lib/i18n';
import { uid } from '../lib/id';
import { Badge, Button, ConfirmButton, cx, Field, inputCls, Modal } from './ui';
import { ParentLinks } from './ParentLink';

function blankPlayer(): Player {
  return { id: uid('player'), name: '', birthYear: new Date().getFullYear() - 12, level: 'beginner', hand: 'right', backhand: 'two', coachId: '', parentId: '', parentIds: [], goals: '' };
}

/** Add / edit one player. */
export function PlayerForm({ initial, onDone }: { initial?: Player; onDone?: () => void }) {
  const { dispatch, t, lang, toast } = useStore();
  const [p, setP] = useState<Player>(initial ?? blankPlayer());
  const year = new Date().getFullYear();
  const valid = p.name.trim().length > 1 && p.birthYear > year - 90 && p.birthYear <= year - 3;
  return (
    <form
      className="grid gap-3 sm:grid-cols-2"
      data-testid="player-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid) return;
        dispatch({ type: 'upsertPlayer', player: { ...p, name: p.name.trim(), goals: p.goals.trim() } });
        toast(t('playerSaved'));
        if (!initial) setP(blankPlayer());
        onDone?.();
      }}
    >
      <div className="sm:col-span-2">
        <Field label={t('playerName')} htmlFor={`pl-name-${p.id}`}>
          <input id={`pl-name-${p.id}`} className={inputCls} value={p.name} autoComplete="off" onChange={(e) => setP({ ...p, name: e.target.value })} />
        </Field>
      </div>
      <Field label={t('birthYear')} htmlFor={`pl-year-${p.id}`}>
        <input id={`pl-year-${p.id}`} type="number" inputMode="numeric" className={inputCls} value={p.birthYear} onChange={(e) => setP({ ...p, birthYear: Number(e.target.value) || 0 })} />
      </Field>
      <Field label={t('level')} htmlFor={`pl-level-${p.id}`}>
        <select id={`pl-level-${p.id}`} className={inputCls} value={p.level} onChange={(e) => setP({ ...p, level: e.target.value as Player['level'] })}>
          {LEVELS.map((l) => (
            <option key={l} value={l}>{levelLabel(lang, l)}</option>
          ))}
        </select>
      </Field>
      <Field label={t('hand')} htmlFor={`pl-hand-${p.id}`}>
        <select id={`pl-hand-${p.id}`} className={inputCls} value={p.hand} onChange={(e) => setP({ ...p, hand: e.target.value as Player['hand'] })}>
          <option value="right">{t('rightHanded')}</option>
          <option value="left">{t('leftHanded')}</option>
        </select>
      </Field>
      <Field label={t('backhandType')} htmlFor={`pl-bh-${p.id}`}>
        <select id={`pl-bh-${p.id}`} className={inputCls} value={p.backhand} onChange={(e) => setP({ ...p, backhand: e.target.value as Player['backhand'] })}>
          <option value="two">{t('twoHanded')}</option>
          <option value="one">{t('oneHanded')}</option>
        </select>
      </Field>
      <div className="sm:col-span-2">
        <Field label={t('goals')} htmlFor={`pl-goals-${p.id}`}>
          <textarea id={`pl-goals-${p.id}`} rows={2} className={inputCls} value={p.goals} onChange={(e) => setP({ ...p, goals: e.target.value })} />
        </Field>
      </div>
      <div className="flex justify-end gap-2 sm:col-span-2">
        {onDone && initial && <Button onClick={onDone}>{t('cancel')}</Button>}
        <Button type="submit" variant="primary" disabled={!valid} data-testid="save-player">
          {initial ? t('save') : `+ ${t('addPlayer')}`}
        </Button>
      </div>
    </form>
  );
}

export function PlayersModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { state, dispatch, t, lang, toast, adapter } = useStore();
  const [editing, setEditing] = useState<string | null>(null);
  const [parentsOf, setParentsOf] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const year = new Date().getFullYear();
  return (
    <Modal open={open} onClose={onClose} title={t('playersTitle')} wide>
      <ul className="mb-4 flex flex-col divide-y divide-line rounded-2xl border border-line" data-testid="players-list">
        {state.players.map((p) =>
          editing === p.id ? (
            <li key={p.id} className="p-4">
              <PlayerForm initial={p} onDone={() => setEditing(null)} />
            </li>
          ) : (
            <li key={p.id} className="flex flex-wrap items-center gap-2 px-4 py-3">
              <button
                type="button"
                className={cx('min-w-0 flex-1 text-start font-semibold', p.id === state.settings.activePlayerId && 'text-accent')}
                onClick={() => {
                  dispatch({ type: 'setActivePlayer', id: p.id });
                  onClose();
                }}
              >
                {p.name}
                <span className="ms-2 text-[13px] font-normal text-muted">
                  {t('age', { n: year - p.birthYear })} · {levelLabel(lang, p.level)}
                </span>
              </button>
              {p.id === state.settings.activePlayerId && <Badge tone="accent">✓</Badge>}
              {adapter.kind === 'artifact' && (
                <Button size="sm" variant="ghost" onClick={() => setParentsOf(parentsOf === p.id ? null : p.id)} data-testid={`parents-${p.id}`}>
                  {t('role_parent')} · {(p.parentIds ?? []).length}
                </Button>
              )}
              <Button size="sm" onClick={() => setEditing(p.id)}>{t('edit')}</Button>
              <ConfirmButton
                label={t('delete')}
                confirmLabel={t('deletePlayerConfirm')}
                onConfirm={() => {
                  dispatch({ type: 'deletePlayer', id: p.id });
                  toast(t('playerDeleted'));
                }}
              />
              {parentsOf === p.id && (
                <div className="w-full">
                  <ParentLinks player={p} />
                </div>
              )}
            </li>
          ),
        )}
      </ul>
      {adding ? (
        <PlayerForm onDone={() => setAdding(false)} />
      ) : (
        <Button variant="primary" onClick={() => setAdding(true)} data-testid="open-add-player">+ {t('addPlayer')}</Button>
      )}
    </Modal>
  );
}
