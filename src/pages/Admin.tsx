import { useMemo, useRef, useState } from 'react';
import { useStore } from '../lib/store';
import { AppStateSchema, CATEGORIES, DrillSchema, KPI_KEYS, LEVELS, type Drill, type Level, type Thresholds } from '../types';
import { catLabel, kpiKey, levelLabel } from '../lib/i18n';
import { href } from '../lib/router';
import { drillsFromCSV, drillsFromJSON, drillsToCSV, drillsToJSON, formatZod, mergeDrills, type ImportResult } from '../lib/drillIO';
import { AGE_SKILL } from '../data/drills/factory';
import { uid } from '../lib/id';
import { Badge, Button, Card, ConfirmButton, copyText, cx, downloadText, Empty, Field, inputCls, Modal, PageHeader, SectionTitle } from '../components/ui';
import { matchesQuery } from './Library';
import { supabaseConfig } from '../lib/storage';
import { TeamPanel } from '../components/TeamPanel';

export function Admin() {
  const { state, dispatch, t, lang, toast, resetDemo, adapter } = useStore();
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<Drill | null>(null);
  const [exportText, setExportText] = useState<{ name: string; text: string } | null>(null);
  const [importRes, setImportRes] = useState<(ImportResult & { added: number; updated: number }) | null>(null);
  const exportRef = useRef<HTMLTextAreaElement>(null);

  const list = useMemo(() => state.drills.filter((d) => matchesQuery(d, q.trim())), [state.drills, q]);

  if (state.settings.role !== 'admin') {
    return (
      <div className="py-10">
        <Empty>{t('adminTitle')}: {t('role_admin')}.</Empty>
      </div>
    );
  }

  const doExport = (kind: 'json' | 'csv' | 'backup') => {
    const text = kind === 'json' ? drillsToJSON(state.drills) : kind === 'csv' ? drillsToCSV(state.drills) : JSON.stringify(state, null, 2);
    const name = kind === 'json' ? 'tennis-progress-drills.json' : kind === 'csv' ? 'tennis-progress-drills.csv' : 'tennis-progress-workspace.json';
    setExportText({ name, text });
    void downloadText(name, text, kind === 'csv' ? 'text/csv' : 'application/json');
  };

  const onImportFile = async (file: File) => {
    const text = await file.text();
    const isCSV = /\.csv$/i.test(file.name) || (!text.trim().startsWith('{') && !text.trim().startsWith('['));
    const res = isCSV ? drillsFromCSV(text) : drillsFromJSON(text);
    const merged = mergeDrills(state.drills, res.drills);
    if (res.drills.length) dispatch({ type: 'importDrills', drills: res.drills });
    setImportRes({ ...res, added: merged.added, updated: merged.updated });
    toast(t('imported', { added: merged.added, updated: merged.updated, errors: res.errors.length }), res.errors.length ? 'warn' : 'ok');
  };

  const onRestore = async (file: File) => {
    try {
      const parsed = AppStateSchema.safeParse(JSON.parse(await file.text()));
      if (!parsed.success) throw new Error(formatZod(parsed.error));
      dispatch({ type: 'replace', state: parsed.data });
      toast(t('restored'));
    } catch (e) {
      toast(t('invalidFile', { msg: e instanceof Error ? e.message.slice(0, 160) : String(e) }), 'error');
    }
  };

  const active = state.drills.filter((d) => !d.archived).length;
  const sb = supabaseConfig();

  return (
    <div>
      <PageHeader eyebrow={t('librarySize', { n: active })} title={t('adminTitle')}>
        <Button variant="primary" onClick={() => setEditing(blankDrill())} data-testid="new-drill">
          + {t('newDrill')}
        </Button>
      </PageHeader>

      <dl className="num mb-6 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-4">
        {[
          [t('drillsCount'), state.drills.length],
          [t('archived'), state.drills.filter((d) => d.archived).length],
          ['Custom', state.drills.filter((d) => d.custom).length],
          [t('logsCount'), state.logs.length],
        ].map(([k, v]) => (
          <div key={String(k)} className="bg-surface p-4">
            <dt className="eyebrow">{k}</dt>
            <dd className="font-mono text-2xl" data-testid={`admin-stat-${String(k)}`}>{v}</dd>
          </div>
        ))}
      </dl>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <section className="min-w-0">
          <SectionTitle>{t('nav_library')}</SectionTitle>
          <input type="search" id="admin-search" className={cx(inputCls, 'mb-3')} placeholder={t('searchDrills')} value={q} onChange={(e) => setQ(e.target.value)} />
          <ul className="max-h-[70dvh] divide-y divide-line overflow-y-auto rounded-2xl border border-line bg-surface" data-testid="admin-list">
            {list.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5">
                <span className="num w-16 shrink-0 font-mono text-[12px] text-muted">{d.id.startsWith('custom') ? 'custom' : d.id}</span>
                <a href={href(`drill-${d.id}`)} className={cx('min-w-0 flex-1 text-sm font-semibold', d.archived && 'text-muted line-through')}>
                  {d.name}
                </a>
                <span className="hidden text-[12px] text-muted sm:inline">{catLabel(lang, d.category)} · {levelLabel(lang, d.level)}</span>
                <div className="flex gap-1">
                  <Button size="sm" onClick={() => setEditing(structuredClone(d))} aria-label={`${t('edit')} ${d.name}`}>
                    {t('edit')}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      dispatch({ type: 'setArchived', id: d.id, archived: !d.archived });
                      toast(d.archived ? t('drillRestored') : t('drillArchived'));
                    }}
                  >
                    {d.archived ? t('unarchive') : t('archive')}
                  </Button>
                  {d.custom && (
                    <ConfirmButton
                      label={t('delete')}
                      confirmLabel={`${t('delete')}?`}
                      onConfirm={() => {
                        dispatch({ type: 'deleteDrill', id: d.id });
                        toast(t('drillDeleted'));
                      }}
                    />
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>

        <div className="flex min-w-0 flex-col gap-5">
          <Card className="p-5">
            <SectionTitle>{t('importExport')}</SectionTitle>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => doExport('json')} data-testid="export-json">{t('exportJSON')}</Button>
              <Button onClick={() => doExport('csv')} data-testid="export-csv">{t('exportCSV')}</Button>
            </div>
            <label className="mt-3 block">
              <span className="text-[13px] font-semibold">{t('importFile')}</span>
              <input
                type="file"
                accept=".json,.csv,application/json,text/csv"
                className="mt-1 block w-full text-sm file:me-3 file:rounded-full file:border-0 file:bg-accent-soft file:px-3 file:py-1.5 file:font-semibold file:text-accent"
                data-testid="import-file"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onImportFile(f);
                  e.target.value = '';
                }}
              />
            </label>
            {importRes && (
              <div className="mt-3 rounded-xl bg-sunken p-3 text-[13px]" data-testid="import-result">
                <p className="font-semibold">{t('imported', { added: importRes.added, updated: importRes.updated, errors: importRes.errors.length })}</p>
                {importRes.errors.length > 0 && (
                  <details className="mt-1">
                    <summary className="cursor-pointer text-bad">{t('importErrors')}</summary>
                    <ul className="mt-1 max-h-40 overflow-y-auto">
                      {importRes.errors.slice(0, 50).map((e, i) => (
                        <li key={i}>
                          #{e.row} {e.id ?? ''}: {e.message}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            )}
            {exportText && (
              <div className="mt-3">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="font-mono text-[12px] text-muted">{exportText.name} · {(exportText.text.length / 1024).toFixed(0)} KB</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={async () => {
                      const ok = await copyText(exportText.text, exportRef.current);
                      toast(ok ? t('copied') : t('copyFallback'), ok ? 'ok' : 'warn');
                    }}
                  >
                    {t('copy')}
                  </Button>
                </div>
                <textarea ref={exportRef} readOnly className={cx(inputCls, 'h-28 font-mono text-[11px]')} value={exportText.text} aria-label={exportText.name} />
                <p className="mt-1 text-[12px] text-muted">{t('downloadNote')}</p>
              </div>
            )}
          </Card>

          <TeamPanel />

          <ThresholdEditor />

          <Card className="p-5">
            <SectionTitle>{t('backup')}</SectionTitle>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => doExport('backup')}>{t('backup')}</Button>
              {adapter.kind !== 'artifact' && (
                <>
              <label className="inline-flex h-10 cursor-pointer items-center rounded-full border border-line px-4 text-sm font-semibold hover:border-accent">
                {t('restore')}
                <input
                  type="file"
                  accept=".json,application/json"
                  className="sr-only"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) onRestore(f);
                    e.target.value = '';
                  }}
                />
              </label>
              <ConfirmButton
                size="md"
                label={t('resetDemo')}
                confirmLabel={t('resetConfirm').split('?')[0] + '?'}
                onConfirm={() => {
                  resetDemo();
                  toast(t('resetDone'));
                }}
              />
                </>
              )}
            </div>
          </Card>

          <Card className="p-5">
            <SectionTitle>{t('supabaseTitle')}</SectionTitle>
            <p className="text-sm text-muted">{adapter.kind === 'artifact' ? adapter.label : sb ? `Configured: ${sb.url}` : t('supabaseOff')}</p>
          </Card>
        </div>
      </div>

      {editing && <DrillEditor drill={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function ThresholdEditor() {
  const { state, dispatch, t, lang, toast } = useStore();
  const [level, setLevel] = useState<Level>('intermediate');
  const th = state.settings.levelDefaults[level];
  const set = (k: (typeof KPI_KEYS)[number], i: number, v: number) => {
    const next: Thresholds = structuredClone(th);
    next[k][i] = v;
    dispatch({ type: 'setLevelDefaults', level, thresholds: next });
  };
  const valid = KPI_KEYS.every((k) => th[k][0] <= th[k][1] && th[k][1] <= th[k][2]);
  return (
    <Card className="p-5">
      <SectionTitle>{t('thresholdsTitle')}</SectionTitle>
      <p className="mb-3 text-[13px] text-muted">{t('thresholdsHelp')} {t('provisional')}</p>
      <select className={cx(inputCls, 'mb-3')} value={level} onChange={(e) => setLevel(e.target.value as Level)} aria-label={t('level')} id="threshold-level">
        {LEVELS.map((l) => (
          <option key={l} value={l}>{levelLabel(lang, l)}</option>
        ))}
      </select>
      <table className="num w-full text-sm">
        <thead>
          <tr className="text-[12px] text-muted">
            <th />
            <th>★</th>
            <th>★★</th>
            <th>★★★</th>
          </tr>
        </thead>
        <tbody>
          {KPI_KEYS.map((k) => (
            <tr key={k}>
              <td className="py-1 pe-2 text-[13px] font-semibold">{t(kpiKey(k))}</td>
              {[0, 1, 2].map((i) => (
                <td key={i} className="p-0.5">
                  <input
                    type="number"
                    min={0}
                    max={100}
                    aria-label={`${t(kpiKey(k))} ${i + 1}★`}
                    id={`th-${level}-${k}-${i}`}
                    className={cx(inputCls, 'px-1 text-center font-mono')}
                    value={th[k][i]}
                    onChange={(e) => set(k, i, Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {!valid && <p className="mt-2 text-[13px] font-semibold text-bad">Star thresholds must be ascending (1★ ≤ 2★ ≤ 3★).</p>}
      <Button
        className="mt-3 w-full"
        disabled={!valid}
        onClick={() => {
          dispatch({ type: 'applyLevelDefaults', level });
          toast(t('appliedDefaults', { n: state.drills.filter((d) => d.level === level).length }));
        }}
      >
        {t('applyDefaults')}
      </Button>
    </Card>
  );
}

function blankDrill(): Drill {
  return {
    id: `custom-${uid().slice(0, 10)}`,
    name: '',
    category: 'forehand',
    level: 'intermediate',
    ageSkill: AGE_SKILL.intermediate,
    objective: '',
    setup: '',
    courtLayout: '',
    players: '1 player + feeder',
    equipment: ['Racquets', 'Basket of balls'],
    durationMin: 15,
    repetitions: '4 sets × 8 balls',
    steps: [],
    cues: [],
    mistakes: [],
    eligibility: '',
    kpi: { attempt: '', decision: '', execution: '' },
    measurement: '',
    thresholds: { attempt: [50, 70, 85], decision: [50, 65, 80], execution: [40, 55, 70], provisional: true },
    progression: '',
    regression: '',
    safety: '',
    video: { url: '', placeholder: true },
    references: [],
    archived: false,
    custom: true,
    updatedAt: new Date().toISOString(),
  };
}

const lines = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean);

function DrillEditor({ drill, onClose }: { drill: Drill; onClose: () => void }) {
  const { state, dispatch, t, lang, toast } = useStore();
  const isNew = !state.drills.some((d) => d.id === drill.id);
  const [f, setF] = useState({
    ...drill,
    equipmentText: drill.equipment.join('\n'),
    stepsText: drill.steps.join('\n'),
    cuesText: drill.cues.join('\n'),
    mistakesText: drill.mistakes.map((m) => `${m.mistake} => ${m.correction}`).join('\n'),
    referencesText: drill.references.join('\n'),
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));

  const save = () => {
    const candidate: Drill = {
      id: f.id,
      name: f.name,
      category: f.category,
      level: f.level,
      ageSkill: f.ageSkill,
      objective: f.objective,
      setup: f.setup,
      courtLayout: f.courtLayout,
      players: f.players,
      equipment: lines(f.equipmentText),
      durationMin: Number(f.durationMin),
      repetitions: f.repetitions,
      steps: lines(f.stepsText),
      cues: lines(f.cuesText),
      mistakes: lines(f.mistakesText).map((l) => {
        const [m, c] = l.split('=>').map((x) => x.trim());
        return { mistake: m ?? '', correction: c ?? '' };
      }),
      eligibility: f.eligibility,
      kpi: f.kpi,
      measurement: f.measurement || `Tally eligible opportunities, attempts, correct decisions and successful executions per set. ${f.eligibility}`,
      thresholds: f.thresholds,
      progression: f.progression,
      regression: f.regression,
      safety: f.safety,
      video: { url: f.video.url.trim(), placeholder: !f.video.url.trim() },
      references: lines(f.referencesText),
      archived: f.archived,
      custom: f.custom,
      updatedAt: new Date().toISOString(),
    };
    const r = DrillSchema.safeParse(candidate);
    if (!r.success) {
      const e: Record<string, string> = {};
      for (const i of r.error.issues) e[String(i.path[0])] ??= i.message;
      setErrors(e);
      toast(`${Object.keys(e).length} field(s) need attention`, 'error');
      return;
    }
    dispatch({ type: 'upsertDrill', drill: r.data });
    toast(t('drillSaved'));
    onClose();
  };

  const txt = (key: 'name' | 'objective' | 'setup' | 'courtLayout' | 'players' | 'repetitions' | 'eligibility' | 'measurement' | 'progression' | 'regression' | 'safety' | 'ageSkill', label: string, rows = 0) => (
    <Field label={label} error={errors[key] && t('required')} htmlFor={`ed-${key}`}>
      {rows ? (
        <textarea id={`ed-${key}`} rows={rows} className={inputCls} value={f[key]} onChange={(e) => set(key, e.target.value)} />
      ) : (
        <input id={`ed-${key}`} className={inputCls} value={f[key]} onChange={(e) => set(key, e.target.value)} />
      )}
    </Field>
  );
  const list = (key: 'equipmentText' | 'stepsText' | 'cuesText' | 'mistakesText' | 'referencesText', errKey: string, label: string, hint: string) => (
    <Field label={label} hint={hint} error={errors[errKey] && `${t('required')} · ${errors[errKey]}`} htmlFor={`ed-${key}`}>
      <textarea id={`ed-${key}`} rows={4} className={inputCls} value={f[key]} onChange={(e) => set(key, e.target.value)} />
    </Field>
  );

  return (
    <Modal open onClose={onClose} title={isNew ? t('newDrill') : t('editDrill')} wide>
      <form
        className="grid gap-4 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
        data-testid="drill-editor"
      >
        <div className="sm:col-span-2 flex flex-wrap items-center gap-2">
          <Badge>{f.id}</Badge>
          {f.custom && <Badge tone="band">Custom</Badge>}
        </div>
        <div className="sm:col-span-2">{txt('name', t('title'))}</div>
        <Field label={t('category')} htmlFor="ed-category">
          <select id="ed-category" className={inputCls} value={f.category} onChange={(e) => set('category', e.target.value as Drill['category'])}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{catLabel(lang, c)}</option>
            ))}
          </select>
        </Field>
        <Field label={t('level')} htmlFor="ed-level">
          <select id="ed-level" className={inputCls} value={f.level} onChange={(e) => { set('level', e.target.value as Level); set('ageSkill', AGE_SKILL[e.target.value as Level]); }}>
            {LEVELS.map((l) => (
              <option key={l} value={l}>{levelLabel(lang, l)}</option>
            ))}
          </select>
        </Field>
        {txt('ageSkill', t('ageSkill'))}
        {txt('players', t('players'))}
        <Field label={`${t('duration')} (${t('minutes')})`} error={errors.durationMin} htmlFor="ed-duration">
          <input id="ed-duration" type="number" min={1} max={180} className={inputCls} value={f.durationMin} onChange={(e) => set('durationMin', Number(e.target.value))} />
        </Field>
        {txt('repetitions', t('reps'))}
        <div className="sm:col-span-2">{txt('objective', t('objective'), 2)}</div>
        {txt('setup', t('setup'), 3)}
        {txt('courtLayout', t('courtLayout'), 3)}
        {list('equipmentText', 'equipment', t('equipment'), t('oneLinePerItem'))}
        {list('stepsText', 'steps', t('steps'), `${t('oneLinePerItem')} (min. 2)`)}
        {list('cuesText', 'cues', t('cues'), t('oneLinePerItem'))}
        {list('mistakesText', 'mistakes', t('mistakes'), t('mistakesHelp'))}
        <div className="sm:col-span-2">{txt('eligibility', t('eligibility'), 2)}</div>
        {KPI_KEYS.map((k) => (
          <Field key={k} label={t(kpiKey(k))} error={errors.kpi && !f.kpi[k].trim() ? t('required') : undefined} htmlFor={`ed-kpi-${k}`}>
            <textarea id={`ed-kpi-${k}`} rows={2} className={inputCls} value={f.kpi[k]} onChange={(e) => set('kpi', { ...f.kpi, [k]: e.target.value })} />
          </Field>
        ))}
        <div className="sm:col-span-2">{txt('measurement', `${t('measurement')} (optional — generated if empty)`, 2)}</div>
        <div className="sm:col-span-2">
          <span className="text-[13px] font-semibold">{t('scoring')}</span>
          <div className="mt-1 grid grid-cols-3 gap-2">
            {KPI_KEYS.map((k) => (
              <div key={k} className="rounded-xl bg-sunken p-2">
                <div className="mb-1 text-[12px] font-semibold">{t(kpiKey(k))}</div>
                <div className="grid grid-cols-3 gap-1">
                  {[0, 1, 2].map((i) => (
                    <input
                      key={i}
                      type="number"
                      aria-label={`${t(kpiKey(k))} ${i + 1}★`}
                      className={cx(inputCls, 'px-1 text-center font-mono')}
                      value={f.thresholds[k][i]}
                      onChange={(e) => {
                        const th = structuredClone(f.thresholds);
                        th[k][i] = Number(e.target.value) || 0;
                        set('thresholds', th);
                      }}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
          {errors.thresholds && <p className="mt-1 text-[12px] font-semibold text-bad">{errors.thresholds}</p>}
        </div>
        {txt('progression', t('progression'), 2)}
        {txt('regression', t('regression'), 2)}
        <div className="sm:col-span-2">{txt('safety', t('safety'), 2)}</div>
        <Field label={`${t('video')} URL`} htmlFor="ed-video">
          <input id="ed-video" type="url" className={inputCls} value={f.video.url} placeholder="https://…" onChange={(e) => set('video', { ...f.video, url: e.target.value })} />
        </Field>
        {list('referencesText', 'references', t('references'), t('oneLinePerItem'))}
        <div className="sticky bottom-0 -mx-5 flex justify-end gap-2 border-t border-line bg-surface px-5 py-3 sm:col-span-2">
          <Button onClick={onClose}>{t('cancel')}</Button>
          <Button type="submit" variant="primary" data-testid="save-drill">{t('save')}</Button>
        </div>
      </form>
    </Modal>
  );
}
