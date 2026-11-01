# Tennis Progress

A family-first tennis development platform. Parents see exactly what their child trains, why each drill was chosen, what the next 10 sessions hold, and whether measurable progress is happening. Coaches pick drills, build and adjust the plan around tournaments, and log results. Admins maintain the drill library and the KPI thresholds.

Stack: **React 19 + TypeScript + Tailwind CSS v4 + Zod**, bundled with **esbuild** (no Vite needed). Persistence: **browser storage in demo mode**, **Supabase** (auth + per-user workspace) when configured.

---

## Quick start

```bash
npm install
npm run dev          # http://localhost:5173 (rebuilds on change)
npm run build        # production build → dist/
npm run preview      # serve dist/ on http://localhost:4173
npm test             # unit tests (19) + drill content quality gate
npm run test:e2e     # builds, serves, runs 18 browser tests on desktop + iPhone-13 profile
npm run typecheck    # strict tsc
npm run build:single # also writes dist/tennis-progress.html (one self-contained file)
```

Requires Node 20+.

## What is in the box

| Area | Status |
|---|---|
| 200 seeded drills (exact split below), every required field filled | ✅ `src/data/drills/*.ts`, validated with Zod at load and in tests |
| Drill library: search, category / level / duration filters, archived toggle, live count | ✅ |
| Drill details: objective, setup, court layout, equipment, steps, cues, mistakes → corrections, eligibility, KPI definitions, measurement protocol, star thresholds, progression, regression, safety, video placeholder, references | ✅ |
| Training planner: 10-session plan, add/remove/reorder sessions and drills, edit everything, explicit Save with unsaved-changes bar, tournament calendar, conflict + taper warnings, one-click reschedule off tournament days, generate the next 10 sessions on chosen weekdays | ✅ |
| Session execution: eligible / attempts / correct decisions / successful executions, error types, notes, context (baseline / practice / match), live KPIs, validation, delete with confirmation, mark completed | ✅ |
| Parent view: read-only calendar with "what & why", coach notes, per-session results; start a self-guided plan and share it with the coach | ✅ (no payments — see limitations) |
| Progress: baseline vs current per drill, progress by drill with trend, training-to-match transfer, match statistics over time | ✅ |
| **Matches:** pre-match questions (practice / official, tournament + round, opponent and level, plays R/L, date, surface, indoor, format presets, sets, games per set, deciding set or 10-point match tie-break, advantage / no-ad, who serves first, point-by-point or final score only) | ✅ `src/pages/MatchSetup.tsx` |
| **Live point tracker:** 1st serve in / fault → 2nd serve in / double fault, ace, unreturned serve; then winner, return winner, forced error, unforced error, return error for either player; optional stroke, rally length (0–4 / 5–8 / 9+) and net; undo; end early (retired / stopped); break / set / match point, deuce, tie-break shown live; parents follow the live score | ✅ `src/pages/MatchPage.tsx`, engine in `src/lib/match.ts` |
| **Match report:** final score, ATP/WTA-style statistics for both players (aces, double faults, 1st serve in, 1st/2nd serve points won, break points saved/won, service games, return points vs 1st/2nd serve, winners, unforced/forced/return errors, total points), momentum chart, points by rally length, winners vs errors by stroke, net points, point-by-point log, coach notes | ✅ `src/pages/MatchReport.tsx` |
| **Tournaments:** details (dates, location, category, surface), aim (results / apply training / both), goals checked automatically — result (reach a round / win), match stat targets, training-focus drills (practice logs in the 6 weeks before), other goals marked by the coach — preparation (countdown, sessions, taper and conflict warnings, notes), matches by round, furthest round, review | ✅ `src/pages/TournamentDetail.tsx`, `src/lib/competition.ts` |
| Admin: add / edit / archive / restore / delete (custom) drills, JSON + CSV import/export with row-level error report, full workspace backup/restore, editable default star thresholds per level, reset demo | ✅ |
| English LTR / Persian RTL toggle (UI fully translated; dates in the Persian calendar) | ✅ |
| Roles: Parent / Coach / Admin with guarded pages | ✅ demo role switcher (see limitations) |

### Drill database — 200 drills

| Category | Count | ID prefix |
|---|---:|---|
| Forehand | 25 | `fh-` |
| Backhand | 20 | `bh-` |
| Serve | 25 | `sv-` |
| Return | 15 | `rt-` |
| Volley & overhead | 15 | `vo-` |
| Footwork & balance | 20 | `fw-` |
| Defense & transition | 15 | `df-` |
| Tactical patterns | 30 | `tp-` |
| Point-play & match simulation | 20 | `pp-` |
| Mental / decision-making | 15 | `mn-` |
| **Total** | **200** | |

Ready-made copies of all 200 drills: `exports/drills.json` and `exports/drills.csv` (Excel-friendly, UTF-8 BOM). Regenerate with `npx tsx scripts/export-drills.ts`.

All four levels (beginner → professional) appear. IDs are stable (`fh-001` …); custom drills get `custom-<random>`. `tp-001 Deep Topspin + Drop Shot` implements the example from the brief exactly, including decision credit for intelligent misses and no credit for drops outside eligible conditions.

`scripts/quality.ts` (part of `npm test`) fails the build if a drill is a duplicate or has thin content (one-word corrections, empty progressions, terse steps).

## KPI engine (`src/lib/kpi.ts`)

| KPI | Formula |
|---|---|
| Attempt rate | attempts ÷ eligible opportunities |
| Decision accuracy | correct decisions ÷ attempts |
| Execution accuracy | successful executions ÷ correct decisions |

* A zero denominator returns `{ ok: false, reason: 'insufficient' }`; the UI shows **Insufficient data**, never `NaN` or `∞`.
* Counts are validated: correct decisions ≤ attempts and ≤ eligible; successful ≤ correct decisions.
* Attempts above eligible opportunities are allowed and flagged as **over-attempting** (forcing the shot outside eligible conditions). Stars cap at 100 %.
* 1★ / 2★ / 3★ thresholds are set **independently** for attempts, decision quality and execution, per drill, with editable level defaults in Admin. They are labelled provisional — starting points, not scientific norms.
* Transfer = match ratio ÷ practice ratio (decision and execution).
* Win/loss is not used anywhere as a measure.

## Architecture

```
src/
  types.ts              Zod schemas → TypeScript types (Drill, Plan, Session, Log, AppState…)
  data/drills/          200 drills, one file per category; factory.ts fills category boilerplate
  data/demo.ts          demo player, parent, coach, admin, 10-session plan, tournament, logs
  lib/kpi.ts            KPI maths (pure, unit-tested)
  lib/match.ts          tennis scoring engine (ad/no-ad, tie-breaks, match tie-break, short sets, serve
                        rotation), 6-character point codes, match statistics, goal metrics (unit-tested)
  lib/competition.ts    tournaments: furthest round, goal evaluation, charted-match aggregates
  lib/schedule.ts       dates, tournament conflicts, taper warnings, rescheduling, plan generation
  lib/reducer.ts        all state changes (pure, unit-tested)
  lib/store.tsx         React context, debounced persistence, toasts, i18n binding
  lib/storage.ts        StorageAdapter: LocalStorageAdapter (demo) · SupabaseAdapter · MemoryAdapter
  lib/drillIO.ts csv.ts JSON/CSV import-export with per-row validation
  lib/i18n.ts           English + Persian dictionaries
  lib/router.tsx        hash routes (#library, #drill-fh-001, #session-<id>, #planner-<id>, #matches,
                        #tournaments, #newmatch[-<tournamentId>], #match-<id>, #tournament-<id>)
  components/ pages/    UI
scripts/build.mjs       esbuild + Tailwind v4 compile API
supabase/schema.sql     table + row-level security
```

## Persistence — shared academy on claude.ai

When the single-file build (`dist/tennis-progress.html`) is published as a claude.ai artifact with the `db` and `user` capabilities, it uses `src/lib/artifactDb.ts`: every player, plan, result and tournament is its own document in the artifact's shared database, changes from other coaches appear live, and the owner is the admin. People the page is shared with as **Editor** are coaches; everyone else sees a no-access screen. Only the owner can change the drill library and default thresholds. Tests: `tests/artifactDb.test.ts` (unit, simulated database) and `e2e/shared.mjs` (browser, two coaches on one simulated database).

## Persistence — demo vs production

**Demo mode (default).** With no Supabase variables, data is saved to `localStorage` in the current browser. Every page footer says so. It is not synced, not backed up, and disappears if browser data is cleared. Use Admin → *Full workspace backup* to keep a copy.

### Connect Supabase

1. Create a Supabase project. In **SQL Editor**, run `supabase/schema.sql`.
2. In **Authentication → Providers**, keep Email enabled.
3. Copy `.env.example` → `.env` (or set the variables in Vercel):
   `SUPABASE_URL`, `SUPABASE_ANON_KEY` (Project Settings → API).
4. `npm run build`. The app now shows a sign-in screen; each user's workspace is stored as one JSON row protected by row-level security. "Continue with demo data" stays available.

The adapter uses Supabase's REST endpoints directly (`/auth/v1`, `/rest/v1`), so no SDK is bundled. v1 keeps one workspace per account; `schema.sql` contains the normalized tables planned for phase 2 (shared player records across coach and parent accounts).

## Deploy to Vercel

```bash
npm i -g vercel
vercel            # vercel.json sets: build = npm run build, output = dist
```

Or import the repo in the Vercel dashboard — no framework preset needed. Add `SUPABASE_URL` / `SUPABASE_ANON_KEY` as environment variables to enable Supabase. Hash routing means no rewrite rules are required.

## Testing

* **Match engine (17 tests, `tests/match.test.ts`)** — point codes, game/deuce/advantage, no-ad deciding point, break points, set rules (6-4, 7-5, tie-break at 6-6), tie-break serve rotation and next-set server, 10-point match tie-break, short sets, replay stops at match end, statistics attribution (serve, return, winners, errors, strokes, rally length, net), break points saved, final-score-only matches, tournament furthest round and goal evaluation, demo matches, every generated label translated.
* **Unit (19 tests, `tests/logic.test.ts`)** — exact drill counts per category, unique IDs and names, every required field, KPI formulas and zero-denominator handling, star thresholds, count validation, CSV parser edge cases, lossless CSV and JSON round-trip of all 200 drills, rejected-row reporting, merge semantics, tournament conflict/reschedule/taper logic, demo-data integrity, reducer rules, stored-state validation, Persian dictionary coverage.
* **End-to-end (26 scenarios × 2 profiles, `e2e/e2e.mjs`)** — matches and tournaments (season record and averages; goals evaluated, added, marked and removed; charting ace / fault / double fault / winner / errors with stroke, rally and net detail, undo and reload; finishing a set and the report; reopening; final-score-only entry with tie-break notation updating the tournament result goal; retirement; parent read-only; Persian layout), library count, search, combined filters, drill details, assigning a drill to a session, planner edit/reorder/save/reschedule, KPI logging with validation and live calculation, delete with confirmation, **reload persistence**, completing a session, Persian RTL toggle and persistence, role guards, parent plan sharing, admin create/edit/archive/restore/delete, JSON/CSV export and re-import (including a file with a bad row), threshold editing, no horizontal overflow on any page, no uncaught errors.

## Known limitations (v1)

* **Persian covers the interface, not the drill text.** Drill names and protocols are English; in RTL mode they render with correct bidirectional isolation.
* **Roles are a demo switcher.** With Supabase on, sign-in is real, but a role is not yet bound to an account; that comes with the phase-2 shared tables.
* **No payments.** A parent can create a self-guided plan and share it with the coach (the data model for "buy a plan"), but purchasing is not implemented.
* **Videos are placeholders.** Admins can add a URL per drill; the drill page links out to it.
* **References.** The drills are coach-authored; no external sources are cited, and the References field is empty unless an admin adds one.
* **Verification environment.** Tested in Chromium (desktop and an iPhone 13 device profile: viewport, touch, Safari user agent). Real WebKit/iOS Safari was not available in the build environment — run `node e2e/e2e.mjs webkit` after `npx playwright install webkit` to cover it. The Supabase adapter is implemented against Supabase's documented REST API but has not been run against a live project. `npm run typecheck` with the real `@types/react` should be run once after `npm install`; in the build environment the UI was type-checked against a minimal React type shim and the logic modules with full strict types.
