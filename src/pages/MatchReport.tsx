import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../lib/store';
import { href, navigate } from '../lib/router';
import { statsFromReplay, summary, type DisplaySet, type Side } from '../lib/match';
import type { Match, MatchFormat } from '../types';
import { Badge, Button, Card, ConfirmButton, cx, Field, inputCls, PageHeader, SectionTitle } from '../components/ui';
import { MomentumChart, names, PlayerBreakdown, ResultBadge, scoreLine, StatsTable, useCanEdit } from '../components/MatchBits';
import { EditMatchModal, MatchContext, PointList } from './MatchPage';

type T = ReturnType<typeof useStore>['t'];

export function formatText(f: MatchFormat, t: T): string {
  const parts = [f.sets === 1 ? t('oneSetOpt') : t('bestOf', { n: f.sets })];
  if (f.games === 4) parts.push(t('shortSetsLabel'));
  if (f.sets > 1 && f.finalSet === 'mtb') parts.push(t('finalMtb'));
  parts.push(f.noAd ? t('noAdShort') : t('adShort'));
  return parts.join(' · ');
}

function FinalScore({ sets, nm, winner }: { sets: DisplaySet[]; nm: Record<Side, string>; winner: Side | null }) {
  return (
    <div className="rounded-2xl bg-band p-4 text-band-ink" data-testid="final-score">
      <table className="num w-full border-separate border-spacing-y-1" dir="ltr">
        <tbody>
          {(['p', 'o'] as Side[]).map((side) => (
            <tr key={side}>
              <td className="max-w-0 pe-2">
                <span className={cx('block truncate text-[17px] font-semibold', winner === side && 'underline decoration-2 underline-offset-4')}>
                  {winner === side && '✓ '}
                  {nm[side]}
                </span>
              </td>
              {sets.map((s, i) => {
                const lostSet = s[side] < s[side === 'p' ? 'o' : 'p'];
                return (
                  <td key={i} className={cx('w-10 text-center font-mono text-2xl', lostSet && 'text-band-muted')}>
                    {s.mtb ? <span className="text-xl">{s[side]}</span> : s[side]}
                    {s.tb !== null && lostSet && <sup className="ms-0.5 text-[11px]">{s.tb}</sup>}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function MatchReport({ m }: { m: Match }) {
  const { state, dispatch, t, toast } = useStore();
  const canEdit = useCanEdit();
  const player = state.players.find((p) => p.id === m.playerId);
  const nm = names(m, player?.name ?? t('player'), t);
  const sum = useMemo(() => summary(m), [m]);
  const st = useMemo(() => (sum.replay ? statsFromReplay(sum.replay) : null), [sum]);
  const tour = m.tournamentId ? state.tournaments.find((x) => x.id === m.tournamentId) : undefined;
  const [notes, setNotes] = useState(m.notes);
  const [editing, setEditing] = useState(false);
  useEffect(() => setNotes(m.notes), [m.id, m.notes]);
  const charted = m.mode === 'live';
  const finishedByScore = charted && sum.replay?.engine.winner;

  return (
    <div>
      <PageHeader eyebrow={<MatchContext m={m} />} title={t('vsName', { name: nm.o })}>
        {canEdit && (
          <>
            <Button size="sm" onClick={() => setEditing(true)} data-testid="edit-match">{t('editDetails')}</Button>
            {charted && (
              <Button
                size="sm"
                data-testid="reopen-match"
                onClick={() => {
                  // A completed match reopens one point back so the result can be corrected.
                  const points = finishedByScore ? m.points.slice(0, -1) : m.points;
                  dispatch({ type: 'saveMatch', match: { ...m, points, status: 'live', winner: null, endReason: 'completed' } });
                  toast(finishedByScore ? t('pointUndone') : t('chartingResumed'));
                }}
              >
                {finishedByScore ? `↶ ${t('undoPoint')}` : t('continueCharting')}
              </Button>
            )}
          </>
        )}
      </PageHeader>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <ResultBadge m={m} />
        <span className="num font-mono text-xl font-semibold" dir="ltr" data-testid="score-line">{scoreLine(m, t)}</span>
        <Badge>{formatText(m.format, t)}</Badge>
        {m.opponentRating && <Badge>{m.opponentRating}</Badge>}
        {m.opponentHand === 'left' && <Badge>{t('leftHanded')}</Badge>}
        <Badge tone={charted ? 'band' : 'neutral'}>{charted ? t('charted') : t('scoreOnly')}</Badge>
        {tour && (
          <a href={href(`tournament-${tour.id}`)} className="text-sm font-semibold text-accent">
            {tour.name} →
          </a>
        )}
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-5">
          <FinalScore sets={sum.sets} nm={nm} winner={sum.winner} />
          {st && st.points > 0 ? (
            <section>
              <SectionTitle>{t('statsTitle')}</SectionTitle>
              <StatsTable st={st} nm={nm} />
            </section>
          ) : (
            <p className="rounded-xl bg-sunken p-3 text-sm text-muted">{charted ? t('noPointsYet') : t('noStatsScoreOnly')}</p>
          )}
        </div>
        <div className="flex min-w-0 flex-col gap-5">
          {st && st.points > 0 && (
            <>
              <MomentumChart st={st} name={nm.p} />
              <PlayerBreakdown st={st} name={nm.p} />
            </>
          )}
          <Card className="p-4">
            <Field label={t('matchNotes')} htmlFor="match-notes">
              {canEdit ? (
                <textarea id="match-notes" rows={4} className={inputCls} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t('matchNotesHint')} />
              ) : (
                <p className="whitespace-pre-wrap text-sm">{m.notes || '—'}</p>
              )}
            </Field>
            {canEdit && (
              <div className="mt-2 flex justify-end">
                <Button
                  size="sm"
                  variant="primary"
                  disabled={notes === m.notes}
                  data-testid="save-match-notes"
                  onClick={() => {
                    dispatch({ type: 'saveMatch', match: { ...m, notes } });
                    toast(t('saved'));
                  }}
                >
                  {t('save')}
                </Button>
              </div>
            )}
          </Card>
        </div>
      </div>

      {sum.replay && sum.replay.ctx.length > 0 && (
        <details className="mt-6">
          <summary className="cursor-pointer font-display text-xl">
            {t('pointByPoint')} <span className="num text-sm text-muted">({sum.replay.ctx.length})</span>
          </summary>
          <div className="mt-3">
            <PointList ctx={sum.replay.ctx} nm={nm} noAd={m.format.noAd} />
          </div>
        </details>
      )}

      {canEdit && (
        <div className="mt-8 flex justify-end border-t border-line pt-4">
          <ConfirmButton
            label={t('deleteMatch')}
            confirmLabel={`${t('deleteMatch')}?`}
            onConfirm={() => {
              dispatch({ type: 'deleteMatch', id: m.id });
              toast(t('matchDeleted'));
              navigate(tour ? `tournament-${tour.id}` : 'matches');
            }}
          />
        </div>
      )}
      {canEdit && editing && <EditMatchModal m={m} open={editing} onClose={() => setEditing(false)} />}
    </div>
  );
}
