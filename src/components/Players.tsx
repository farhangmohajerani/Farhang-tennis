import { useState } from 'react';
import { useStore } from '../lib/store';
import { LEVELS, type Player } from '../types';
import { asciiDigits, levelLabel } from '../lib/i18n';
import { uid } from '../lib/id';
import { getSocial, reloadConnections } from '../lib/social';
import { Badge, Button, ConfirmButton, cx, Field, inputCls, Modal, SectionTitle } from './ui';
import { ParentLinks } from './ParentLink';
import { DisconnectButton, Handle, MyUsername, PeopleSearch, RequestsList, useConnections } from './Social';

/** ownerId: usernames mode — a player without an account belongs to the coach who added it. */
function blankPlayer(ownerId?: string | null): Player {
  return {
    id: uid('player'),
    name: '',
    birthYear: new Date().getFullYear() - 12,
    level: 'beginner',
    hand: 'right',
    backhand: 'two',
    coachId: '',
    parentId: '',
    parentIds: [],
    goals: '',
    ...(ownerId ? { ownerId } : {}),
  };
}

/** Add / edit one player. */
export function PlayerForm({ initial, onDone }: { initial?: Player; onDone?: () => void }) {
  const { dispatch, t, lang, toast, adapter } = useStore();
  const owner = adapter.social ? adapter.myId : null;
  const [p, setP] = useState<Player>(initial ?? blankPlayer(owner));
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
        if (!initial) setP(blankPlayer(owner));
        onDone?.();
      }}
    >
      <div className="sm:col-span-2">
        <Field label={t('playerName')} htmlFor={`pl-name-${p.id}`}>
          <input id={`pl-name-${p.id}`} className={inputCls} value={p.name} autoComplete="off" onChange={(e) => setP({ ...p, name: e.target.value })} />
        </Field>
      </div>
      <Field label={t('birthYear')} htmlFor={`pl-year-${p.id}`}>
        <input
          id={`pl-year-${p.id}`}
          inputMode="numeric"
          dir="ltr"
          className={inputCls}
          value={p.birthYear || ''}
          onChange={(e) => setP({ ...p, birthYear: Number(asciiDigits(e.target.value).replace(/\D/g, '').slice(0, 4)) || 0 })}
        />
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

/** Usernames mode: move a player without an account into a connected family account. */
function LinkToAccount({ player, onDone }: { player: Player; onDone: () => void }) {
  const { state, dispatch, t, toast } = useStore();
  const social = getSocial();
  const accounts = state.players.filter((x) => x.accountId && x.username);
  const [target, setTarget] = useState(accounts[0]?.id ?? '');
  if (!social) return null;
  if (!accounts.length) return <p className="w-full text-[13px] text-muted" data-testid="link-none">{t('linkNone')}</p>;
  const to = accounts.find((x) => x.id === target);
  return (
    <div className="flex w-full flex-wrap items-center gap-2 rounded-xl bg-sunken p-2" data-testid={`link-box-${player.id}`}>
      <label className="text-[13px] font-semibold" htmlFor={`link-${player.id}`}>
        {t('linkPick')}
      </label>
      <select id={`link-${player.id}`} className={cx(inputCls, 'w-auto py-1.5 text-[13px]')} value={target} onChange={(e) => setTarget(e.target.value)}>
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name} (@{a.username})
          </option>
        ))}
      </select>
      <ConfirmButton
        label={t('linkGo')}
        confirmLabel={t('linkConfirm')}
        variant="primary"
        onConfirm={async () => {
          if (!to?.username) return;
          try {
            const r = await social.merge(player.id, to.username);
            if (r?.error) {
              toast(t(r.error === 'not_connected' ? 'socialErr_not_connected' : r.error === 'not_found' ? 'socialErr_not_found' : 'socialErr'), 'error');
              return;
            }
            toast(t('linked', { n: r?.moved ?? 0, u: to.username }));
            dispatch({ type: 'setActivePlayer', id: to.id });
            social.refresh();
            void reloadConnections();
            onDone();
          } catch {
            toast(t('socialErr'), 'error');
          }
        }}
      />
    </div>
  );
}

export function PlayersModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { state, dispatch, t, lang, toast, adapter } = useStore();
  const [editing, setEditing] = useState<string | null>(null);
  const [parentsOf, setParentsOf] = useState<string | null>(null);
  const [linking, setLinking] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const social = adapter.social ? getSocial() : null;
  const conns = useConnections();
  const year = new Date().getFullYear();
  const connected = (u?: string) => !!u && (conns ?? []).some((c) => c.username === u && c.status === 'accepted');
  return (
    <Modal open={open} onClose={onClose} title={t('playersTitle')} wide>
      {social && (
        <>
          <MyUsername />
          <RequestsList />
          <SectionTitle>{t('findPlayerTitle')}</SectionTitle>
          <p className="-mt-1 mb-2 text-[13px] text-muted">{t('findPlayerHelp')}</p>
          <div className="mb-5">
            <PeopleSearch />
          </div>
          <SectionTitle>{t('myPlayersTitle')}</SectionTitle>
          {!state.players.length && <p className="mb-3 text-sm text-muted">{t('noPlayersYet')}</p>}
        </>
      )}
      <ul className={cx('mb-4 flex flex-col divide-y divide-line rounded-2xl border border-line', !state.players.length && 'hidden')} data-testid="players-list">
        {state.players.map((p) =>
          editing === p.id ? (
            <li key={p.id} className="p-4">
              <PlayerForm initial={p} onDone={() => setEditing(null)} />
            </li>
          ) : (
            <li key={p.id} className="flex flex-wrap items-center gap-2 px-4 py-3" data-testid={`player-row-${p.id}`}>
              <button
                type="button"
                className={cx(
                  'min-w-0 text-start font-semibold',
                  // Usernames mode: the name gets its own line on phones, the buttons go below it.
                  social ? 'basis-full sm:basis-0 sm:flex-1' : 'flex-1',
                  p.id === state.settings.activePlayerId && 'text-accent',
                )}
                onClick={() => {
                  dispatch({ type: 'setActivePlayer', id: p.id });
                  onClose();
                }}
              >
                {social ? (
                  <>
                    <span className="block">{p.name}</span>
                    <span className="block text-[13px] font-normal text-muted">
                      {p.accountId && p.username ? <Handle u={p.username} /> : <Badge tone="warn" className="whitespace-nowrap">{t('noAccountBadge')}</Badge>} · {t('age', { n: year - p.birthYear })} ·{' '}
                      {levelLabel(lang, p.level)}
                    </span>
                  </>
                ) : (
                  <>
                    {p.name}
                    <span className="ms-2 text-[13px] font-normal text-muted">
                      {t('age', { n: year - p.birthYear })} · {levelLabel(lang, p.level)}
                    </span>
                  </>
                )}
              </button>
              {p.id === state.settings.activePlayerId && <Badge tone="accent">✓</Badge>}
              {adapter.kind === 'artifact' && !adapter.social && (
                <Button
                  size="sm"
                  variant={parentsOf === p.id ? 'primary' : 'secondary'}
                  aria-expanded={parentsOf === p.id}
                  onClick={() => setParentsOf(parentsOf === p.id ? null : p.id)}
                  data-testid={`parents-${p.id}`}
                >
                  <span aria-hidden="true">🔗</span>
                  {t('connectParentBtn')}
                  {(p.parentIds ?? []).length > 0 && ` · ${(p.parentIds ?? []).length}`}
                </Button>
              )}
              <Button size="sm" onClick={() => setEditing(p.id)} data-testid={`edit-player-${p.id}`}>
                {t('edit')}
              </Button>
              {social && !p.accountId && (
                <Button
                  size="sm"
                  variant={linking === p.id ? 'primary' : 'secondary'}
                  aria-expanded={linking === p.id}
                  onClick={() => setLinking(linking === p.id ? null : p.id)}
                  data-testid={`link-${p.id}`}
                >
                  {t('linkToAccount')}
                </Button>
              )}
              {social && p.accountId ? (
                // A family's own account: a coach can only disconnect, never delete it.
                connected(p.username) && <DisconnectButton username={p.username!} />
              ) : (
                <ConfirmButton
                  label={t('delete')}
                  confirmLabel={t('deletePlayerConfirm')}
                  onConfirm={() => {
                    dispatch({ type: 'deletePlayer', id: p.id });
                    toast(t('playerDeleted'));
                  }}
                />
              )}
              {parentsOf === p.id && (
                <div className="w-full">
                  <ParentLinks player={p} />
                </div>
              )}
              {linking === p.id && <LinkToAccount player={p} onDone={() => setLinking(null)} />}
            </li>
          ),
        )}
      </ul>
      {adding ? (
        <>
          {social && <p className="mb-2 text-[13px] text-muted">{t('offlineHelp')}</p>}
          <PlayerForm onDone={() => setAdding(false)} />
        </>
      ) : (
        <Button variant={social ? 'secondary' : 'primary'} onClick={() => setAdding(true)} data-testid="open-add-player">
          + {t(social ? 'addOfflinePlayer' : 'addPlayer')}
        </Button>
      )}
    </Modal>
  );
}
