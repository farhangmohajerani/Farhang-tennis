// Flags thin/terse drill content so seed data stays coach-grade. Exit 1 on failures.
import { SEED_DRILLS } from '../src/data/drills';
const per: Record<string, string[]> = {};
const flag = (id: string, m: string) => (per[id] ??= []).push(m);
const names = new Set<string>();
for (const d of SEED_DRILLS) {
  const key = `${d.id} ${d.name}`;
  if (names.has(d.name.toLowerCase())) flag(key, 'DUPLICATE NAME');
  names.add(d.name.toLowerCase());
  d.mistakes.forEach((m) => { if (m.correction.length < 20) flag(key, `correction "${m.correction}"`); if (m.mistake.length < 6) flag(key, `mistake "${m.mistake}"`); });
  if (d.progression.length < 14) flag(key, `progression "${d.progression}"`);
  if (d.regression.length < 11) flag(key, `regression "${d.regression}"`);
  const shortSteps = d.steps.filter((s) => s.length < 12).length;
  if (shortSteps >= 2) flag(key, `${shortSteps} terse steps`);
  if (d.kpi.decision.length < 25) flag(key, `decision "${d.kpi.decision}"`);
  if (d.objective.length < 30) flag(key, `objective "${d.objective}"`);
  if (d.cues.some((c) => c.length < 5)) flag(key, 'terse cue');
}
const bad = Object.entries(per).filter(([, v]) => v.length >= 2 || v.some((x) => x.startsWith('DUP')));
for (const [k, v] of bad) console.log(`${k}\n   - ${v.join('\n   - ')}`);
console.log(`\n${SEED_DRILLS.length} drills, ${bad.length} thin drills (>=2 issues)`);
process.exit(bad.length ? 1 : 0);
