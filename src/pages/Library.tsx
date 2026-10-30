import { useMemo, useState, type ReactNode } from 'react';
import { useStore } from '../lib/store';
import { CATEGORIES, LEVELS, type Category, type Drill, type Level } from '../types';
import { catLabel, levelLabel } from '../lib/i18n';
import { href } from '../lib/router';
import { Badge, Button, cx, Empty, Icon, inputCls, PageHeader } from '../components/ui';
import { AddToSession } from '../components/AddToSession';

type Dur = 'any' | 'short' | 'mid' | 'long';

export function matchesQuery(d: Drill, q: string): boolean {
  if (!q) return true;
  const hay = [d.id, d.name, d.objective, d.setup, d.eligibility, ...d.cues, ...d.steps].join(' ').toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => hay.includes(w));
}

export function Library() {
  const { state, t, lang } = useStore();
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<Category | 'all'>('all');
  const [level, setLevel] = useState<Level | 'all'>('all');
  const [dur, setDur] = useState<Dur>('any');
  const [showArchived, setShowArchived] = useState(false);
  const [adding, setAdding] = useState<Drill | null>(null);
  const canPlan = state.settings.role !== 'parent';

  const active = state.drills.filter((d) => showArchived || !d.archived);
  const results = useMemo(
    () =>
      active.filter(
        (d) =>
          (cat === 'all' || d.category === cat) &&
          (level === 'all' || d.level === level) &&
          (dur === 'any' || (dur === 'short' && d.durationMin <= 12) || (dur === 'mid' && d.durationMin > 12 && d.durationMin <= 20) || (dur === 'long' && d.durationMin > 20)) &&
          matchesQuery(d, q.trim()),
      ),
    [active, cat, level, dur, q],
  );
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const d of active) c[d.category] = (c[d.category] ?? 0) + 1;
    return c;
  }, [active]);
  const filtered = q || cat !== 'all' || level !== 'all' || dur !== 'any';

  return (
    <div>
      <PageHeader eyebrow={t('librarySize', { n: state.drills.filter((d) => !d.archived).length })} title={t('nav_library')} />

      <div className="mb-4 rounded-2xl border border-line bg-surface p-3">
        <div className="relative">
          <Icon.search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input id="drill-search" type="search" className={cx(inputCls, 'ps-9')} placeholder={t('searchDrills')} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t('search')} />
        </div>
        <div className="mt-2 flex gap-1.5 overflow-x-auto pb-1" role="group" aria-label={t('category')}>
          <Chip on={cat === 'all'} onClick={() => setCat('all')}>
            {t('all')} <span className="num opacity-70">{active.length}</span>
          </Chip>
          {CATEGORIES.map((c) => (
            <Chip key={c} on={cat === c} onClick={() => setCat(c)} testId={`cat-${c}`}>
              {catLabel(lang, c)} <span className="num opacity-70">{counts[c] ?? 0}</span>
            </Chip>
          ))}
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
          <select id="level-filter" aria-label={t('level')} className={cx(inputCls, 'sm:w-44')} value={level} onChange={(e) => setLevel(e.target.value as Level | 'all')}>
            <option value="all">{t('level')}: {t('all')}</option>
            {LEVELS.map((l) => (
              <option key={l} value={l}>
                {levelLabel(lang, l)}
              </option>
            ))}
          </select>
          <select id="duration-filter" aria-label={t('duration')} className={cx(inputCls, 'sm:w-44')} value={dur} onChange={(e) => setDur(e.target.value as Dur)}>
            <option value="any">{t('duration')}: {t('all')}</option>
            <option value="short">≤ 12 {t('minutes')}</option>
            <option value="mid">13–20 {t('minutes')}</option>
            <option value="long">&gt; 20 {t('minutes')}</option>
          </select>
          <label className="col-span-2 flex items-center gap-2 text-[13px] font-semibold sm:ms-2">
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
            {t('showArchived')}
          </label>
          {filtered && (
            <Button size="sm" variant="ghost" className="col-span-2 sm:ms-auto" onClick={() => { setQ(''); setCat('all'); setLevel('all'); setDur('any'); }}>
              {t('clearFilters')}
            </Button>
          )}
        </div>
      </div>

      <p className="mb-3 text-[13px] text-muted num" data-testid="result-count">
        {t('showing', { n: results.length, total: active.length })}
      </p>

      {results.length === 0 ? (
        <Empty>{t('noResults')}</Empty>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="drill-list">
          {results.map((d) => (
            <li key={d.id} className="flex min-w-0 flex-col rounded-2xl border border-line bg-surface p-4" data-drill-id={d.id}>
              <div className="mb-2 flex flex-wrap items-center gap-1.5">
                <Badge tone="accent">{catLabel(lang, d.category)}</Badge>
                <Badge>{levelLabel(lang, d.level)}</Badge>
                {d.archived && <Badge tone="warn">{t('archived')}</Badge>}
                {d.custom && <Badge tone="band">Custom</Badge>}
                <span className="num ms-auto font-mono text-[12px] text-muted">{d.id}</span>
              </div>
              <h3 className="text-[17px] font-bold leading-snug">
                <a href={href(`drill-${d.id}`)} className="hover:text-accent">
                  {d.name}
                </a>
              </h3>
              <p className="mt-1 line-clamp-3 text-sm text-muted">{d.objective}</p>
              <div className="num mt-3 flex flex-wrap gap-x-3 text-[12px] text-muted">
                <span>⏱ {d.durationMin} {t('minutes')}</span>
                <span>{d.players}</span>
              </div>
              <div className="mt-auto flex gap-2 pt-3">
                <a href={href(`drill-${d.id}`)} className="inline-flex h-8 items-center rounded-full border border-line px-3 text-[13px] font-semibold hover:border-accent">
                  {t('viewDrill')}
                </a>
                {canPlan && !d.archived && (
                  <Button size="sm" variant="ghost" onClick={() => setAdding(d)}>
                    + {t('addToSession')}
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {adding && <AddToSession drill={adding} open={!!adding} onClose={() => setAdding(null)} />}
    </div>
  );
}

function Chip({ on, onClick, children, testId }: { on: boolean; onClick: () => void; children: ReactNode; testId?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      data-testid={testId}
      className={cx('shrink-0 rounded-full border px-3 py-1 text-[13px] font-semibold', on ? 'border-accent bg-accent text-accent-ink' : 'border-line bg-surface text-ink hover:border-accent')}
    >
      {children}
    </button>
  );
}
