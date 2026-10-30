-- Tennis Progress — Supabase schema (run in the Supabase SQL editor).
-- v1 stores each signed-in user's workspace (drills, plans, sessions, logs, settings)
-- as one validated JSON document. Row-level security limits every row to its owner.

create table if not exists public.workspace_state (
  owner      uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  data       jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.workspace_state enable row level security;

drop policy if exists "own workspace: select" on public.workspace_state;
drop policy if exists "own workspace: insert" on public.workspace_state;
drop policy if exists "own workspace: update" on public.workspace_state;
drop policy if exists "own workspace: delete" on public.workspace_state;

create policy "own workspace: select" on public.workspace_state for select using (auth.uid() = owner);
create policy "own workspace: insert" on public.workspace_state for insert with check (auth.uid() = owner);
create policy "own workspace: update" on public.workspace_state for update using (auth.uid() = owner) with check (auth.uid() = owner);
create policy "own workspace: delete" on public.workspace_state for delete using (auth.uid() = owner);

-- Phase 2 (not used by v1 code): normalized tables so coaches and parents can share one
-- player's data across accounts. Kept here as the migration target.
-- create table public.players (id uuid primary key default gen_random_uuid(), name text not null, birth_year int, level text, coach_id uuid references auth.users, parent_id uuid references auth.users);
-- create table public.plans (id uuid primary key default gen_random_uuid(), player_id uuid references public.players on delete cascade, owner text check (owner in ('coach','parent')), shared_with_coach uuid references auth.users, data jsonb not null);
-- create table public.drill_logs (id uuid primary key default gen_random_uuid(), player_id uuid references public.players on delete cascade, drill_id text not null, session_id text, date date not null, context text check (context in ('baseline','practice','match')), eligible int not null check (eligible >= 0), attempts int not null check (attempts >= 0), correct_decisions int not null check (correct_decisions between 0 and least(attempts, eligible)), successful int not null check (successful between 0 and correct_decisions), errors jsonb, notes text, created_at timestamptz default now());
