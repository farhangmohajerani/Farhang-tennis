import { useState, type ReactNode } from 'react';
import { useStore } from '../lib/store';
import { KPI_KEYS } from '../types';
import { catLabel, kpiKey, levelLabel, formatDate, type DictKey } from '../lib/i18n';
import { href } from '../lib/router';
import { activePlayer } from '../lib/reducer';
import { playerLogs, stats } from '../lib/selectors';
import { isOverAttempting } from '../lib/kpi';
import { Badge, Button, Card, Empty, KpiTile } from '../components/ui';
import { AddToSession } from '../components/AddToSession';

export function DrillDetail({ id }: { id: string }) {
  const { state, t, lang } = useStore();
  const [adding, setAdding] = useState(false);
  const d = state.drills.find((x) => x.id === id);
  const player = activePlayer(state);
  if (!d) {
    return (
      <div className="py-10">
        <Empty>
          Drill “{id}” not found. <a className="font-semibold text-accent" href={href('library')}>{t('back')}</a>
        </Empty>
      </div>
    );
  }
  const logs = player ? playerLogs(state, player.id).filter((l) => l.drillId === d.id) : [];
  const s = stats(logs.filter((l) => l.context !== 'match'));
  const canPlan = state.settings.role !== 'parent';
  const videoOk = /^https?:\/\//.test(d.video.url);

  return (
    <article className="pb-6">
      <div className="pt-5">
        <a href={href('library')} className="text-[13px] font-semibold text-accent">
          ← {t('nav_library')}
        </a>
      </div>
      <header className="flex flex-wrap items-end justify-between gap-3 pb-5 pt-3">
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            <Badge tone="accent">{catLabel(lang, d.category)}</Badge>
            <Badge>{levelLabel(lang, d.level)}</Badge>
            {d.archived && <Badge tone="warn">{t('archived')}</Badge>}
            <span className="num font-mono text-[12px] text-muted">{d.id}</span>
          </div>
          <h1 className="font-display text-[34px] leading-[1.05] md:text-[44px]" data-testid="drill-title">{d.name}</h1>
          <p className="mt-2 max-w-[65ch] text-[17px]">{d.objective}</p>
        </div>
        {canPlan && !d.archived && (
          <Button variant="primary" onClick={() => setAdding(true)}>
            + {t('addToSession')}
          </Button>
        )}
      </header>

      <dl className="num mb-6 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-line bg-line md:grid-cols-4">
        <Fact label={t('duration')} value={`${d.durationMin} ${t('minutes')}`} />
        <Fact label={t('reps')} value={d.repetitions} />
        <Fact label={t('players')} value={d.players} />
        <Fact label={t('ageSkill')} value={d.ageSkill} />
      </dl>

      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <div className="flex min-w-0 flex-col gap-5">
          <Block title={t('setup')}>
            <p>{d.setup}</p>
            <h4 className="eyebrow mt-4 mb-1">{t('courtLayout')}</h4>
            <p>{d.courtLayout}</p>
            <h4 className="eyebrow mt-4 mb-1">{t('equipment')}</h4>
            <ul className="flex flex-wrap gap-1.5">
              {d.equipment.map((e) => (
                <li key={e}>
                  <Badge>{e}</Badge>
                </li>
              ))}
            </ul>
          </Block>

          <Block title={t('steps')}>
            <ol className="flex flex-col gap-2.5">
              {d.steps.map((st, i) => (
                <li key={i} className="flex gap-3">
                  <span className="num mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-band font-mono text-[12px] text-band-ink">{i + 1}</span>
                  <span>{st}</span>
                </li>
              ))}
            </ol>
          </Block>

          <Block title={t('cues')}>
            <ul className="flex flex-wrap gap-2">
              {d.cues.map((c) => (
                <li key={c} className="rounded-full border border-accent/40 bg-accent-soft px-3 py-1 text-sm font-semibold text-accent">
                  “{c}”
                </li>
              ))}
            </ul>
          </Block>

          <Block title={t('mistakes')}>
            <ul className="flex flex-col divide-y divide-line">
              {d.mistakes.map((m, i) => (
                <li key={i} className="grid gap-1 py-2.5 sm:grid-cols-2 sm:gap-4">
                  <span className="text-bad">✕ {m.mistake}</span>
                  <span className="text-good">→ {m.correction}</span>
                </li>
              ))}
            </ul>
          </Block>

          <div className="grid gap-5 sm:grid-cols-2">
            <Block title={t('progression')}>
              <p>{d.progression}</p>
            </Block>
            <Block title={t('regression')}>
              <p>{d.regression}</p>
            </Block>
          </div>

          <Block title={t('safety')}>
            <p>{d.safety}</p>
          </Block>
        </div>

        <div className="flex min-w-0 flex-col gap-5">
          <div className="flex aspect-video max-w-full flex-col items-center justify-center gap-2 rounded-2xl border border-line bg-band p-4 text-center text-band-muted" data-testid="video-placeholder">
            <svg viewBox="0 0 48 48" className="h-10 w-10" aria-hidden="true">
              <circle cx="24" cy="24" r="22" fill="none" stroke="currentColor" strokeWidth="2" />
              <path d="M19 15l14 9-14 9z" fill="currentColor" />
            </svg>
            {videoOk ? (
              <a href={d.video.url} target="_blank" rel="noreferrer" className="font-semibold text-accent underline">
                {t('video')} ↗
              </a>
            ) : (
              <span className="text-sm">{t('videoPlaceholder')}</span>
            )}
          </div>

          <Card className="p-5">
            <h3 className="eyebrow mb-1">{t('eligibility')}</h3>
            <p className="font-semibold">{d.eligibility}</p>
            <h3 className="eyebrow mt-5 mb-2">{t('kpiDefs')}</h3>
            <dl className="flex flex-col gap-3">
              {KPI_KEYS.map((k) => (
                <div key={k}>
                  <dt className="text-sm font-bold">
                    {t(kpiKey(k))} <span className="font-mono text-[12px] font-normal text-muted">= {t(`kpiFormula_${k}` as DictKey)}</span>
                  </dt>
                  <dd className="text-sm text-muted">{d.kpi[k]}</dd>
                </div>
              ))}
            </dl>
          </Card>

          <Card className="p-5">
            <h3 className="eyebrow mb-2">{t('scoring')}</h3>
            <table className="num w-full text-sm">
              <thead>
                <tr className="text-muted">
                  <th className="py-1 text-start font-semibold" />
                  <th className="py-1 font-semibold">★</th>
                  <th className="py-1 font-semibold">★★</th>
                  <th className="py-1 font-semibold">★★★</th>
                </tr>
              </thead>
              <tbody>
                {KPI_KEYS.map((k) => (
                  <tr key={k} className="border-t border-line">
                    <td className="py-1.5 font-semibold">{t(kpiKey(k))}</td>
                    {d.thresholds[k].map((v, i) => (
                      <td key={i} className="py-1.5 text-center font-mono">≥{v}%</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {d.thresholds.provisional && <p className="mt-2 text-[12px] text-muted">{t('provisional')}</p>}
          </Card>

          <Card className="p-5">
            <h3 className="eyebrow mb-2">{t('measurement')}</h3>
            <p className="text-sm">{d.measurement}</p>
          </Card>

          {player && (
            <Card className="p-5">
              <h3 className="eyebrow mb-3">
                {t('results')} · {player.name}
              </h3>
              <div className="grid grid-cols-3 gap-2">
                {KPI_KEYS.map((k) => (
                  <KpiTile key={k} k={k} r={s.kpis[k]} levels={d.thresholds[k]} compact />
                ))}
              </div>
              {isOverAttempting(s.totals) && <p className="mt-3 rounded-xl bg-warn-soft p-3 text-[13px] font-semibold text-warn">{t('overAttempting')}</p>}
              {logs.length > 0 ? (
                <ul className="num mt-3 flex flex-col divide-y divide-line text-[13px]">
                  {logs.slice(-5).reverse().map((l) => (
                    <li key={l.id} className="flex flex-wrap gap-x-3 py-1.5">
                      <span>{formatDate(lang, l.date)}</span>
                      <Badge tone={l.context === 'match' ? 'band' : l.context === 'baseline' ? 'warn' : 'neutral'}>{t(`ctx_${l.context}` as DictKey)}</Badge>
                      <span className="font-mono text-muted">
                        E{l.eligible} · A{l.attempts} · D{l.correctDecisions} · S{l.successful}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 text-sm text-muted">{t('noLogs')}</p>
              )}
            </Card>
          )}

          <Card className="p-5">
            <h3 className="eyebrow mb-2">{t('references')}</h3>
            {d.references.length ? (
              <ul className="list-disc ps-5 text-sm">
                {d.references.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">{t('noReferences')}</p>
            )}
          </Card>
        </div>
      </div>
      {adding && <AddToSession drill={d} open={adding} onClose={() => setAdding(false)} />}
    </article>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 bg-surface p-3">
      <dt className="eyebrow mb-0.5">{label}</dt>
      <dd className="text-sm font-semibold">{value}</dd>
    </div>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="min-w-0">
      <h2 className="mb-2 font-display text-2xl">{title}</h2>
      <div className="text-[15px] leading-relaxed">{children}</div>
    </section>
  );
}
