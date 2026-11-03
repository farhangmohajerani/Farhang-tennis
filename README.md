# 21GRAM Tennis

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
| **Live point tracker — one screen, in the order a point is played:** the serve (1st serve assumed, Fault → 2nd serve, direction wide / body / T, ace, unreturned serve, double fault — one tap), the return (forehand, backhand, forehand slice, backhand slice → return error / return winner), the rally for each player (forehand, backhand, slices, volleys, overhead, drop shot, lob, passing shot, approach, half-volley → winner / forced error / unforced error). **Tapping a stroke opens its results right below it**, with optional rally length (0–4 / 5–8 / 9+) and who was at the net (filled in from volleys, overheads, approaches and passing shots); tapping a result saves the point. **Deuce or ad court worked out from the score**; undo hands the point back with its stroke open for a quick fix; end early (retired / stopped); break / set / match point, deuce, tie-break shown live; parents follow the live score | ✅ `src/pages/MatchPage.tsx`, `src/lib/pointEntry.ts`, engine in `src/lib/match.ts` |
| **Match report:** final score; statistics for both players in the Grand Slam / ATP-WTA categories — aces, double faults, 1st serve in, 1st/2nd serve points won, service points won, unreturned serves, break points saved, service games; return points won (vs 1st/2nd serve), **returns in play vs 1st/2nd serve**, return errors, break points won, return games won; winners, unforced and forced errors, **net points won for both players**, tie-break points won, **most points / games in a row**, total points — for the **whole match or each set**; momentum chart; **four separate charts: each player's winners and each player's errors** (serve, return and rally shots — e.g. backhand volley, forehand slice — with unforced / forced split, on shared scales); serve and return on the deuce vs ad court and serve direction for both players side by side; points by rally length; point-by-point log; coach notes | ✅ `src/pages/MatchReport.tsx`, charts in `src/components/MatchBits.tsx` |
| **Tournaments:** details (dates, location, category, surface), aim (results / apply training / both), goals checked automatically — result (reach a round / win), match stat targets, training-focus drills (practice logs in the 6 weeks before), other goals marked by the coach — preparation (countdown, sessions, taper and conflict warnings, notes), matches by round, furthest round, review | ✅ `src/pages/TournamentDetail.tsx`, `src/lib/competition.ts` |
| **21GRAM Tennis Pro (subscriptions):** every drill is Free or Pro (default: beginner drills and the academy's own drills free; the admin switches any drill in the list, the editor or the CSV `access` column). With subscriptions switched on (Admin → Subscriptions, off by default), coaches and admins have every drill (the academy's plan); parents need the **Family plan**, except for drills the coach put in their child's plan. Locked drills show a Pro card instead of their content; the library has a Free / Pro filter. The admin gives Family plans by hand (1 month, 1 year, no end date) until App Store purchases are added | ✅ `src/lib/access.ts`, `src/components/SubscriptionsPanel.tsx`, `supabase/subscriptions.sql` |
| **AI Coach (bring your own key):** on the match report and the live page, a coach asks their own **OpenAI** or **Google Gemini** model for a two-paragraph debrief — tactical analysis, then weaknesses with what to train — in English or Persian. The request goes straight from the browser to the provider with the coach's key (kept only on that device, never in the database); only statistics and the point log are sent, never names. The answer is kept with the match so parents read it too; clear messages for a wrong key, no credit, an unknown model or a blocked connection | ✅ `src/lib/ai.ts`, `src/components/AiCoach.tsx` |
| **Usernames and connections (online version):** everyone signs up as a **coach** or a **family** (one family account = one player) and picks a username. A coach finds a player by username or name under **Players** and sends a request; a family finds a coach under **My coaches** the same way. When the other side accepts, they are connected — the coach plans for the player, the family follows the plan, and both follow and chart live matches. A player can have several coaches; either side can disconnect, which stops access at once without deleting anything. Coaches sign up freely; the admin (staff table) sees everyone under **Admin → Members** | ✅ `supabase/social.sql`, `src/components/Social.tsx`, `src/lib/social.ts`, `e2e/supabase.mjs` |
| **Players without an account:** a coach can add a player who has no account yet; only that coach sees it. When the family creates an account and connects, the coach asks to move its plans, results, tournaments and matches over and the **family allows or declines** (the admin can move them at once) | ✅ `request_link()` / `respond_link()` in `supabase/social-2.sql`, `src/components/Players.tsx` |
| **Permission before anything (online version):** sign-up records acceptance of the privacy notice and, for a family, that a parent or guardian makes the account; accounts from before are asked once. Before a coach gets access, the family sees exactly what the coach can and cannot see, and decides about AI analysis (off until allowed). Families are found only by their exact username unless they choose to be found by name; after a family declines or disconnects, the same coach waits 30 days to ask again. Only whoever made a plan, result, tournament or match deletes it | ✅ `supabase/social-2.sql`, `src/components/PrivacyNotice.tsx`, `AllowCoachSheet` in `src/components/Social.tsx`, `e2e/supabase.mjs` |
| **"Match started" notifications:** when a live match starts, the family and connected coaches get one phone notification (Web Push; on iPhone after adding the app to the Home Screen) and, with the app open, a "follow live?" alert. Notifications are asked for at the moment they make sense, and can be turned off in Settings | ✅ Edge Function `supabase/functions/notify` (keys made and kept on the server), `src/lib/push.ts`, `public/sw.js`, `src/components/Onboarding.tsx` |
| **Simple family home, Settings, admin moderation:** a family lands on one screen (live score, requests, next session, last result, coaches) with a first-run guide; a player with several coaches switches between their plans. Settings holds name, username, notifications, privacy, player details, password and account deletion. The admin can mark coaches verified, pause an account or delete it | ✅ `src/pages/Dashboard.tsx`, `src/components/Settings.tsx`, `MembersPanel` in `src/components/Social.tsx` |
| **Connecting parents with codes (claude.ai version):** inside claude.ai the coach connects a parent with a 6-digit code | ✅ `src/components/ParentLink.tsx` |
| **Live score both ways:** whoever starts a match charts it (its scorer); everyone else follows it live (about 2 s). Families can start and chart matches for their own player — nothing else becomes editable for them — and connected coaches see every point; a coach can **take over** the scoring. Only the scorer writes, so two devices never overwrite each other | ✅ `useMatchRights` in `src/components/MatchBits.tsx`, family writes in `src/lib/artifactDb.ts`, `family_save_match()` in `supabase/social.sql`, `e2e/live-sync.mjs` (point-by-point accuracy and delay, both directions) |
| **Share the match report:** one HTML file anyone can open (result, every statistic, winners/errors by stroke, momentum, set by set, point by point, notes, AI analysis), previewed before sending, in Persian or English; send it through the share sheet (Mail, WhatsApp, AirDrop, Files), download it, save it as PDF, or copy / email a short summary | ✅ `src/lib/matchExport.ts`, `src/components/ExportMatch.tsx`, `tests/export.test.ts` |
| **Change password** in the app (footer): at least 10 characters with a letter and a number, no simple sequences | ✅ `ChangePasswordModal` in `src/components/Layout.tsx` |
| **Account deletion inside the app** (App Store rule 5.1.1(v)): removes the sign-in, the profile and connections, a family's player with its data, and a coach's players without an account; the last admin cannot delete their account | ✅ Edge Function `supabase/functions/delete-account` (or `delete_my_account()` in `supabase/subscriptions.sql`), footer of every page |
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

1. Create a Supabase project. In **SQL Editor**, run `supabase/academy.sql`, then `supabase/coach-requests.sql`, `supabase/subscriptions.sql` (plans and account deletion), `supabase/invites.sql`, `supabase/family-matches.sql`, `supabase/staff-codes.sql` (the first admin) and `supabase/social.sql` (usernames and connections; it closes the earlier code-based ways in). Every file can be run again safely. The admin is the first account that signs up with the email of an unused admin row in `staff_invites` (add one in the Table editor before the owner signs up).
2. Run `supabase/social-2.sql` (consents, privacy, approvals, moderation, notification devices). In it, set the `app_url` row to your app's address.
3. Deploy the functions (keep their JWT check on): `supabase functions deploy delete-account` and `supabase functions deploy notify`. The notify function makes its own Web Push key pair on first use and keeps it in `app_keys`, which only the server reads — no secrets to set. Without `delete-account` the app uses `delete_my_account()` from `subscriptions.sql`.
4. In **Authentication → Providers**, keep Email enabled.
5. Copy `.env.example` → `.env` (or set the variables in Vercel):
   `SUPABASE_URL`, `SUPABASE_ANON_KEY` (Project Settings → API).
6. `npm run build`. The app now shows a sign-in screen; each user's workspace is stored as one JSON row protected by row-level security. "Continue with demo data" stays available.

The adapter uses Supabase's REST endpoints directly (`/auth/v1`, `/rest/v1`), so no SDK is bundled. v1 keeps one workspace per account; `schema.sql` contains the normalized tables planned for phase 2 (shared player records across coach and parent accounts).

## Deploy to Vercel

```bash
npm i -g vercel
vercel            # vercel.json sets: build = npm run build, output = dist
```

Or import the repo in the Vercel dashboard — no framework preset needed. Add `SUPABASE_URL` / `SUPABASE_ANON_KEY` as environment variables to enable Supabase. Hash routing means no rewrite rules are required.

## Testing

* **Match engine (24 tests, `tests/match.test.ts`)** — point codes, point composition (who hit the last shot, net rules, double fault in one tap), every stroke button × result on the point screen and its undo round trip, returns in play, runs, tie-break points, one-set statistics, opponent net points, game/deuce/advantage, no-ad deciding point, break points, set rules (6-4, 7-5, tie-break at 6-6), tie-break serve rotation and next-set server, 10-point match tie-break, short sets, replay stops at match end, statistics attribution (serve, return, winners, errors, strokes, rally length, net), break points saved, final-score-only matches, tournament furthest round and goal evaluation, demo matches, every generated label translated.
* **AI Coach (5 tests, `tests/ai.test.ts`)** — the brief carries every statistic, breakdown and point but no names; OpenAI and Gemini requests (key in a header, model, language) and answer parsing; errors for key, quota, model, network and empty answers; tidying into two paragraphs.
* **Plans (4 tests, `tests/access.test.ts`)** — free / Pro default rule and admin choice, who has Pro (staff, active Family plan, expiry), locks only with subscriptions on and never for drills in the child's plan, CSV round trip of the choice and older files without it, the switch and the choices travelling in family documents.
* **Unit (19 tests, `tests/logic.test.ts`)** — exact drill counts per category, unique IDs and names, every required field, KPI formulas and zero-denominator handling, star thresholds, count validation, CSV parser edge cases, lossless CSV and JSON round-trip of all 200 drills, rejected-row reporting, merge semantics, tournament conflict/reschedule/taper logic, demo-data integrity, reducer rules, stored-state validation, Persian dictionary coverage.
* **End-to-end (29 scenarios × 2 profiles, `e2e/e2e.mjs`)** — AI Coach with mocked OpenAI and Gemini (key set-up, answer kept after reload, no names sent, invalid-key message, parents read only); subscriptions (admin switch, a drill made Pro, parent locks and Pro card, assigned drills open, Free filter, staff unlocked); matches and tournaments (season record and averages; goals evaluated, added, marked and removed; charting serve → return → rally on one screen — ace, fault, double fault, forehand volley opening its results with rally length and net, opponent's backhand error at the net, backhand-slice return error — undo that reopens the stroke for a fix, reload; finishing a set and the report with the new statistics and the four winners / errors charts; statistics per set; reopening; final-score-only entry with tie-break notation updating the tournament result goal; retirement; parent read-only; Persian layout), library count, search, combined filters, drill details, assigning a drill to a session, planner edit/reorder/save/reschedule, KPI logging with validation and live calculation, delete with confirmation, **reload persistence**, completing a session, Persian RTL toggle and persistence, role guards, parent plan sharing, admin create/edit/archive/restore/delete, JSON/CSV export and re-import (including a file with a bad row), threshold editing, no horizontal overflow on any page, no uncaught errors.
* **Online version (24 steps, `e2e/supabase.mjs`, against `e2e/mock-supabase.mjs`)** — sign-up with coach / family, username and name (only a–z, 0–9, '.' and '_'); a taken username chosen again on the next screen; a coach finds a family by username, the family accepts from the dashboard (request badge), the player appears for the coach without reloading; a family finds a coach and the coach accepts; a coach who is not connected sees and writes nothing; a family reads only its own player and writes only its own matches; a player without an account seen only by its coach, then linked to the family's new account with its plan moved over; live score coach → family and family → coach; disconnecting stops access without deleting data; the admin's member list; Family plans; an older account choosing a username at sign-in; sign-in screens, password change, and account deletion through the Edge Function (a family; a coach whose players without an account go with them; the only admin is refused). **Live score (`e2e/live-sync.mjs`)** — 40 points coach → family and 30 family → coach, the follower's scoreboard compared after every point (about 2 s), reload mid-match, take over.
* **Access rules (`bash supabase/tests/run.sh`)** — the real SQL files in a throwaway local PostgreSQL: 66 checks of usernames, requests, who sees and writes which documents, linking a player without an account, and the family's live score; 7 checks of account deletion. The rules were also checked on the live database inside transactions that were rolled back.

## Known limitations (v1)

* **Persian covers the interface, not the drill text.** Drill names and protocols are English; in RTL mode they render with correct bidirectional isolation.
* **Roles are a demo switcher.** With Supabase on, sign-in is real, but a role is not yet bound to an account; that comes with the phase-2 shared tables.
* **No payments.** A parent can create a self-guided plan and share it with the coach (the data model for "buy a plan"), but purchasing is not implemented.
* **Videos are placeholders.** Admins can add a URL per drill; the drill page links out to it.
* **References.** The drills are coach-authored; no external sources are cited, and the References field is empty unless an admin adds one.
* **Verification environment.** Tested in Chromium (desktop and an iPhone 13 device profile: viewport, touch, Safari user agent). Real WebKit/iOS Safari was not available in the build environment — run `node e2e/e2e.mjs webkit` after `npx playwright install webkit` to cover it. The Supabase adapter is implemented against Supabase's documented REST API but has not been run against a live project. `npm run typecheck` with the real `@types/react` should be run once after `npm install`; in the build environment the UI was type-checked against a minimal React type shim and the logic modules with full strict types.
