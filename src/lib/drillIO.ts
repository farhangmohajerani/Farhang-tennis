import { z } from 'zod';
import { DrillSchema, type Drill } from '../types';
import { parseCSV, toCSV } from './csv';

/** Column order for CSV. Arrays use " | " separators; nested objects are JSON. */
export const DRILL_CSV_COLUMNS = [
  'id', 'name', 'category', 'level', 'ageSkill', 'objective', 'setup', 'courtLayout', 'players',
  'equipment', 'durationMin', 'repetitions', 'steps', 'cues', 'mistakes', 'eligibility',
  'kpi_attempt', 'kpi_decision', 'kpi_execution', 'measurement', 'thresholds', 'progression',
  'regression', 'safety', 'video_url', 'references', 'archived', 'custom', 'updatedAt',
] as const;

const SEP = ' | ';

export function drillsToCSV(drills: Drill[]): string {
  const rows = drills.map((d) => [
    d.id, d.name, d.category, d.level, d.ageSkill, d.objective, d.setup, d.courtLayout, d.players,
    d.equipment.join(SEP), d.durationMin, d.repetitions, d.steps.join(SEP), d.cues.join(SEP),
    JSON.stringify(d.mistakes), d.eligibility, d.kpi.attempt, d.kpi.decision, d.kpi.execution,
    d.measurement, JSON.stringify(d.thresholds), d.progression, d.regression, d.safety,
    d.video.url, d.references.join(SEP), d.archived, d.custom, d.updatedAt,
  ]);
  return toCSV([[...DRILL_CSV_COLUMNS], ...rows]);
}

export interface ImportResult {
  drills: Drill[];
  errors: { row: number; id?: string; message: string }[];
}

function splitList(s: string): string[] {
  return s.split('|').map((x) => x.trim()).filter(Boolean);
}

export function drillsFromCSV(text: string): ImportResult {
  const rows = parseCSV(text);
  const result: ImportResult = { drills: [], errors: [] };
  if (!rows.length) return { drills: [], errors: [{ row: 0, message: 'Empty file' }] };
  const header = rows[0].map((h) => h.trim());
  const missing = DRILL_CSV_COLUMNS.filter((c) => !header.includes(c));
  if (missing.length) return { drills: [], errors: [{ row: 1, message: `Missing columns: ${missing.join(', ')}` }] };
  const col = (r: string[], name: (typeof DRILL_CSV_COLUMNS)[number]) => r[header.indexOf(name)] ?? '';
  rows.slice(1).forEach((r, idx) => {
    const rowNo = idx + 2;
    try {
      const candidate = {
        id: col(r, 'id').trim(),
        name: col(r, 'name'),
        category: col(r, 'category').trim(),
        level: col(r, 'level').trim(),
        ageSkill: col(r, 'ageSkill'),
        objective: col(r, 'objective'),
        setup: col(r, 'setup'),
        courtLayout: col(r, 'courtLayout'),
        players: col(r, 'players'),
        equipment: splitList(col(r, 'equipment')),
        durationMin: Number(col(r, 'durationMin')),
        repetitions: col(r, 'repetitions'),
        steps: splitList(col(r, 'steps')),
        cues: splitList(col(r, 'cues')),
        mistakes: JSON.parse(col(r, 'mistakes') || '[]'),
        eligibility: col(r, 'eligibility'),
        kpi: { attempt: col(r, 'kpi_attempt'), decision: col(r, 'kpi_decision'), execution: col(r, 'kpi_execution') },
        measurement: col(r, 'measurement'),
        thresholds: JSON.parse(col(r, 'thresholds') || 'null'),
        progression: col(r, 'progression'),
        regression: col(r, 'regression'),
        safety: col(r, 'safety'),
        video: { url: col(r, 'video_url'), placeholder: !col(r, 'video_url') },
        references: splitList(col(r, 'references')),
        archived: col(r, 'archived').trim().toLowerCase() === 'true',
        custom: col(r, 'custom').trim().toLowerCase() === 'true',
        updatedAt: col(r, 'updatedAt') || new Date().toISOString(),
      };
      const parsed = DrillSchema.safeParse(candidate);
      if (parsed.success) result.drills.push(parsed.data);
      else result.errors.push({ row: rowNo, id: candidate.id, message: formatZod(parsed.error) });
    } catch (e) {
      result.errors.push({ row: rowNo, message: e instanceof Error ? e.message : String(e) });
    }
  });
  return result;
}

export function drillsToJSON(drills: Drill[]): string {
  return JSON.stringify({ format: 'tennis-progress/drills', version: 1, count: drills.length, drills }, null, 2);
}

export function drillsFromJSON(text: string): ImportResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { drills: [], errors: [{ row: 0, message: `Invalid JSON: ${e instanceof Error ? e.message : String(e)}` }] };
  }
  const list = Array.isArray(raw) ? raw : z.object({ drills: z.array(z.unknown()) }).safeParse(raw).success ? (raw as { drills: unknown[] }).drills : null;
  if (!list) return { drills: [], errors: [{ row: 0, message: 'Expected an array of drills or { drills: [...] }' }] };
  const result: ImportResult = { drills: [], errors: [] };
  list.forEach((d, i) => {
    const p = DrillSchema.safeParse(d);
    if (p.success) result.drills.push(p.data);
    else result.errors.push({ row: i + 1, id: (d as { id?: string })?.id, message: formatZod(p.error) });
  });
  return result;
}

export function formatZod(err: z.ZodError): string {
  return err.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
}

/** Merge imported drills into the library: same id → replace, new id → append. Duplicate ids in the import keep the last. */
export function mergeDrills(existing: Drill[], incoming: Drill[]): { drills: Drill[]; added: number; updated: number } {
  const map = new Map(existing.map((d) => [d.id, d]));
  let added = 0;
  let updated = 0;
  for (const d of incoming) {
    if (map.has(d.id)) updated++;
    else added++;
    map.set(d.id, d);
  }
  return { drills: Array.from(map.values()), added, updated };
}
