import { useState, type ReactNode } from 'react';
import { useStore } from '../lib/store';
import { href, navigate } from '../lib/router';
import { activePlayer } from '../lib/reducer';
import { todayISO } from '../lib/schedule';
import { uid } from '../lib/id';
import type { DictKey } from '../lib/i18n';
import { FORMAT_PRESETS, winnerFromSets, type Side } from '../lib/match';
import { MATCH_ROUNDS, SURFACES, type Match, type MatchFormat, type SetScore } from '../types';
import { Button, Card, cx, Empty, Field, inputCls, PageHeader } from '../components/ui';
import { roundLabel, surfaceLabel, useCanEdit } from '../components/MatchBits';

/** Segmented choice (radio group with big touch targets). */
export function Seg<V extends string | number | boolean>({
  value,
  options,
  onChange,
  label,
  disabled,
}: {
  value: V;
  options: { value: V; label: ReactNode; testid?: string }[];
  onChange: (v: V) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          disabled={disabled}
          data-testid={o.testid}
          onClick={() => onChange(o.value)}
          className={cx(
            'min-h-10 rounded-full border px-3.5 py-1.5 text-[14px] font-semibold disabled:opacity-50',
            value === o.value ? 'border-accent bg-accent text-accent-ink' : 'border-line bg-surface hover:border-accent',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-3 border-t border-line pt-4 first:border-0 first:pt-0">
      <legend className="eyebrow mb-1">{title}</legend>
      {children}
    </fieldset>
  );
}

const sameFormat = (a: MatchFormat, b: MatchFormat) => a.sets === b.sets && a.games === b.games && a.noAd === b.noAd && (a.sets === 1 || a.finalSet === b.finalSet);

/** Create or edit a match: the questions asked before the first point. */
export function MatchForm({ initial, editing, onSubmit, onCancel }: { initial: Match; editing: boolean; onSubmit: (m: Match) => void; onCancel?: () => void }) {
  const { state, t } = useStore();
  const [m, setM] = useState<Match>(initial);
  const [retired, setRetired] = useState(initial.mode === 'score' && initial.endReason === 'retired');
  const set = (patch: Partial<Match>) => setM((x) => ({ ...x, ...patch }));
  const setFormat = (patch: Partial<MatchFormat>) => setM((x) => ({ ...x, format: { ...x.format, ...patch } }));
  const tournaments = state.tournaments.filter((x) => x.playerId === m.playerId);
  const formatLocked = editing && m.mode === 'live' && m.points.length > 0;
  const rows = m.mode === 'score' ? padSets(m.sets, m.format.sets === 1 ? 1 : 2) : [];
  const computed = m.mode === 'score' ? winnerFromSets(rows.filter((s) => s.p || s.o), m.format) : null;
  const winner: Side | null = m.mode === 'score' ? (retired ? m.winner : computed) : null;
  const scoreOk = m.mode !== 'score' || (rows.some((s) => s.p || s.o) && winner !== null);

  const submit = () => {
    if (!scoreOk) return;
    const out: Match = { ...m, opponent: m.opponent.trim(), opponentRating: m.opponentRating.trim() };
    if (out.kind === 'practice') {
      out.tournamentId = null;
      out.round = null;
    }
    if (out.format.sets === 1) out.format = { ...out.format, finalSet: 'full' };
    if (out.mode === 'score') {
      out.sets = rows.filter((s) => s.p || s.o);
      out.status = 'done';
      out.winner = winner;
      out.endReason = retired ? 'retired' : 'completed';
      out.points = [];
    }
    onSubmit(out);
  };

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      data-testid="match-form"
    >
      <Group title={t('matchType')}>
        <Seg
          label={t('matchType')}
          value={m.kind}
          onChange={(kind) => set({ kind })}
          options={[
            { value: 'practice', label: t('kind_practiceMatch'), testid: 'mt-practice' },
            { value: 'official', label: t('kind_official'), testid: 'mt-official' },
          ]}
        />
        {m.kind === 'official' && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('tournament')} htmlFor="m-tournament">
              <select
                id="m-tournament"
                className={inputCls}
                value={m.tournamentId ?? ''}
                onChange={(e) => {
                  const tour = tournaments.find((x) => x.id === e.target.value);
                  set({ tournamentId: tour?.id ?? null, ...(tour && tour.surface ? { surface: tour.surface, indoor: tour.indoor } : {}) });
                }}
              >
                <option value="">{t('noTournament')}</option>
                {tournaments.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t('round')} htmlFor="m-round">
              <select id="m-round" className={inputCls} value={m.round ?? ''} onChange={(e) => set({ round: (e.target.value || null) as Match['round'] })}>
                <option value="">—</option>
                {MATCH_ROUNDS.map((r) => (
                  <option key={r} value={r}>
                    {roundLabel(t, r)}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        )}
      </Group>

      <Group title={t('opponent')}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('opponentName')} htmlFor="m-opponent">
            <input id="m-opponent" className={inputCls} value={m.opponent} onChange={(e) => set({ opponent: e.target.value })} autoComplete="off" />
          </Field>
          <Field label={t('opponentRating')} hint={t('opponentRatingHint')} htmlFor="m-rating">
            <input id="m-rating" className={inputCls} value={m.opponentRating} onChange={(e) => set({ opponentRating: e.target.value })} autoComplete="off" />
          </Field>
        </div>
        <Seg
          label={t('opponentHand')}
          value={m.opponentHand ?? 'right'}
          onChange={(opponentHand) => set({ opponentHand })}
          options={[
            { value: 'right', label: t('rightHanded'), testid: 'hand-right' },
            { value: 'left', label: t('leftHanded'), testid: 'hand-left' },
          ]}
        />
      </Group>

      <Group title={t('conditions')}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('date')} htmlFor="m-date">
            <input id="m-date" type="date" className={inputCls} value={m.date} onChange={(e) => e.target.value && set({ date: e.target.value })} />
          </Field>
          <label className="flex items-center gap-2 self-end pb-2 text-sm font-semibold">
            <input id="m-indoor" type="checkbox" className="h-5 w-5" checked={m.indoor} onChange={(e) => set({ indoor: e.target.checked })} />
            {t('indoor')}
          </label>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[13px] font-semibold">{t('surface')}</span>
          <Seg
            label={t('surface')}
            value={m.surface ?? ('' as const)}
            onChange={(v) => set({ surface: v || null })}
            options={SURFACES.map((s) => ({ value: s, label: surfaceLabel(t, s), testid: `surface-${s}` }))}
          />
        </div>
      </Group>

      <Group title={t('format')}>
        {formatLocked ? (
          <p className="rounded-xl bg-sunken p-3 text-sm text-muted">{t('formatLocked')}</p>
        ) : (
          <>
            <div className="flex flex-wrap gap-1.5">
              {FORMAT_PRESETS.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  data-testid={`preset-${p.key}`}
                  aria-pressed={sameFormat(p.format, m.format)}
                  onClick={() => set({ format: { ...p.format } })}
                  className={cx(
                    'rounded-xl border px-3 py-2 text-start text-[13px] font-semibold leading-snug',
                    sameFormat(p.format, m.format) ? 'border-accent bg-accent-soft text-accent' : 'border-line hover:border-accent',
                  )}
                >
                  {t(`preset_${p.key}` as DictKey)}
                </button>
              ))}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t('setsLabel')} htmlFor="m-sets">
                <select id="m-sets" className={inputCls} value={m.format.sets} onChange={(e) => setFormat({ sets: Number(e.target.value) as MatchFormat['sets'] })}>
                  <option value={1}>{t('oneSetOpt')}</option>
                  <option value={3}>{t('bestOf', { n: 3 })}</option>
                  <option value={5}>{t('bestOf', { n: 5 })}</option>
                </select>
              </Field>
              <Field label={t('gamesPerSet')} htmlFor="m-games">
                <select id="m-games" className={inputCls} value={m.format.games} onChange={(e) => setFormat({ games: Number(e.target.value) as MatchFormat['games'] })}>
                  <option value={6}>{t('games6')}</option>
                  <option value={4}>{t('games4')}</option>
                </select>
              </Field>
              {m.format.sets > 1 && (
                <Field label={t('finalSet')} htmlFor="m-final">
                  <select id="m-final" className={inputCls} value={m.format.finalSet} onChange={(e) => setFormat({ finalSet: e.target.value as MatchFormat['finalSet'] })}>
                    <option value="mtb">{t('finalMtb')}</option>
                    <option value="full">{t('finalFull')}</option>
                  </select>
                </Field>
              )}
              <Field label={t('matchScoring')} htmlFor="m-noad">
                <select id="m-noad" className={inputCls} value={m.format.noAd ? 'noad' : 'ad'} onChange={(e) => setFormat({ noAd: e.target.value === 'noad' })}>
                  <option value="ad">{t('adScoring')}</option>
                  <option value="noad">{t('noAdScoring')}</option>
                </select>
              </Field>
            </div>
          </>
        )}
      </Group>

      {!editing && (
        <Group title={t('howRecord')}>
          <Seg
            label={t('howRecord')}
            value={m.mode}
            onChange={(mode) => set({ mode })}
            options={[
              { value: 'live', label: t('modeLive'), testid: 'mode-live' },
              { value: 'score', label: t('modeScore'), testid: 'mode-score' },
            ]}
          />
          <p className="text-[13px] text-muted">{m.mode === 'live' ? t('modeLiveHelp') : t('modeScoreHelp')}</p>
        </Group>
      )}

      {m.mode === 'live' && !formatLocked && (
        <Group title={t('firstServer')}>
          <Seg
            label={t('firstServer')}
            value={m.firstServer}
            onChange={(firstServer) => set({ firstServer })}
            options={[
              { value: 'p', label: state.players.find((p) => p.id === m.playerId)?.name ?? t('player'), testid: 'first-p' },
              { value: 'o', label: m.opponent.trim() || t('opponent'), testid: 'first-o' },
            ]}
          />
        </Group>
      )}

      {m.mode === 'score' && (
        <Group title={t('finalScore')}>
          <div className="flex flex-col gap-2" data-testid="set-editor">
            {rows.map((s, i) => {
              const mtb = m.format.sets > 1 && m.format.finalSet === 'mtb' && i === m.format.sets - 1;
              const upd = (patch: Partial<SetScore>) => {
                const next = padSets(m.sets, rows.length).map((x, j) => (j === i ? { ...x, ...patch } : x));
                set({ sets: next });
              };
              const num = (v: string) => Math.max(0, Math.min(99, parseInt(v.replace(/\D/g, '') || '0', 10)));
              return (
                <div key={i} className="grid grid-cols-[88px_1fr_1fr_1fr] items-end gap-2">
                  <span className="pb-2 text-[13px] font-semibold">{mtb ? t('matchTiebreak') : t('setN', { n: i + 1 })}</span>
                  <Field label={state.players.find((p) => p.id === m.playerId)?.name.split(' ')[0] ?? t('player')} htmlFor={`set-${i}-p`}>
                    <input id={`set-${i}-p`} inputMode="numeric" className={cx(inputCls, 'num text-center font-mono')} value={s.p || ''} placeholder="0" onChange={(e) => upd({ p: num(e.target.value) })} />
                  </Field>
                  <Field label={(m.opponent.trim() || t('opponent')).split(' ')[0]} htmlFor={`set-${i}-o`}>
                    <input id={`set-${i}-o`} inputMode="numeric" className={cx(inputCls, 'num text-center font-mono')} value={s.o || ''} placeholder="0" onChange={(e) => upd({ o: num(e.target.value) })} />
                  </Field>
                  {!mtb ? (
                    <Field label={t('tiebreakPts')} htmlFor={`set-${i}-tb`}>
                      <input
                        id={`set-${i}-tb`}
                        inputMode="numeric"
                        className={cx(inputCls, 'num text-center font-mono')}
                        value={s.tb ?? ''}
                        placeholder="—"
                        onChange={(e) => upd({ tb: e.target.value.trim() === '' ? null : num(e.target.value) })}
                      />
                    </Field>
                  ) : (
                    <span />
                  )}
                </div>
              );
            })}
            {rows.length < m.format.sets && (
              <Button size="sm" className="self-start" onClick={() => set({ sets: [...padSets(m.sets, rows.length), { p: 0, o: 0, tb: null }] })} data-testid="add-set">
                + {t('addSet')}
              </Button>
            )}
            <p className="text-[12px] text-muted">{t('tiebreakHint')}</p>
          </div>
          <label className="flex items-center gap-2 text-sm font-semibold">
            <input type="checkbox" className="h-5 w-5" checked={retired} onChange={(e) => setRetired(e.target.checked)} data-testid="score-retired" />
            {t('endedEarly')}
          </label>
          {retired && (
            <Seg
              label={t('winnerLabel')}
              value={m.winner ?? ('' as const)}
              onChange={(v) => set({ winner: (v || null) as Side | null })}
              options={[
                { value: 'p', label: state.players.find((p) => p.id === m.playerId)?.name ?? t('player'), testid: 'score-winner-p' },
                { value: 'o', label: m.opponent.trim() || t('opponent'), testid: 'score-winner-o' },
              ]}
            />
          )}
          <p className={cx('text-sm font-semibold', scoreOk ? 'text-good' : 'text-warn')} data-testid="score-winner">
            {winner ? t('winnerIs', { name: winner === 'p' ? state.players.find((p) => p.id === m.playerId)?.name ?? t('player') : m.opponent.trim() || t('opponent') }) : t('scoreIncomplete')}
          </p>
        </Group>
      )}

      <div className="flex flex-wrap justify-end gap-2 border-t border-line pt-4">
        {onCancel && <Button onClick={onCancel}>{t('cancel')}</Button>}
        <Button type="submit" variant="primary" disabled={!scoreOk} data-testid="match-submit" className="min-w-40">
          {editing ? t('save') : m.mode === 'live' ? t('startMatch') : t('saveResult')}
        </Button>
      </div>
    </form>
  );
}

function padSets(sets: SetScore[], min: number): SetScore[] {
  const out = sets.map((s) => ({ ...s }));
  while (out.length < min) out.push({ p: 0, o: 0, tb: null });
  return out;
}

export function MatchSetup({ tournamentId }: { tournamentId: string }) {
  const { state, dispatch, t, toast } = useStore();
  const player = activePlayer(state);
  const canEdit = useCanEdit();
  if (!player) return <Empty>{t('noPlayerYet')}</Empty>;
  if (!canEdit) return <div className="py-10"><Empty>{t('coachOnly')}</Empty></div>;
  const today = todayISO();
  const tour = tournamentId ? state.tournaments.find((x) => x.id === tournamentId && x.playerId === player.id) : undefined;
  const now = new Date().toISOString();
  const initial: Match = {
    id: uid('match'),
    playerId: player.id,
    date: tour && (today < tour.start || today > tour.end) ? tour.start : today,
    kind: tour ? 'official' : 'practice',
    tournamentId: tour?.id ?? null,
    round: null,
    opponent: '',
    opponentRating: '',
    opponentHand: 'right',
    surface: tour?.surface ?? null,
    indoor: tour?.indoor ?? false,
    format: { ...FORMAT_PRESETS[0].format },
    firstServer: 'p',
    mode: 'live',
    points: [],
    sets: [],
    status: 'live',
    endReason: 'completed',
    winner: null,
    notes: '',
    createdAt: now,
    updatedAt: now,
  };
  return (
    <div>
      <PageHeader eyebrow={player.name} title={t('newMatch')}>
        <a href={href(tour ? `tournament-${tour.id}` : 'matches')} className="text-sm font-semibold text-accent">
          {t('back')}
        </a>
      </PageHeader>
      <p className="-mt-2 mb-5 max-w-[65ch] text-muted">{t('beforeStartHelp')}</p>
      <Card className="max-w-3xl p-5">
        <MatchForm
          initial={initial}
          editing={false}
          onSubmit={(m) => {
            dispatch({ type: 'saveMatch', match: m });
            if (m.mode === 'score') toast(t('resultSaved'));
            navigate(`match-${m.id}`);
          }}
        />
      </Card>
    </div>
  );
}
