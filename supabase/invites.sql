-- 21GRAM Tennis — "Connect coach": a parent types a 6-digit code the coach made for their child.
-- (The other direction, the coach typing the parent's code, is in academy.sql.)
-- Run once in Supabase → SQL Editor → New query → paste → Run. Safe to run again.

-- One code per player, valid 7 days. Only the functions below touch these tables.
create table if not exists public.player_invites (
  player_id text primary key,
  code text not null unique,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.player_invites enable row level security;

-- Wrong codes per account, to stop guessing (10 per hour).
create table if not exists public.invite_attempts (
  user_id uuid not null references auth.users (id) on delete cascade,
  at timestamptz not null default now()
);
create index if not exists invite_attempts_user_idx on public.invite_attempts (user_id, at);
alter table public.invite_attempts enable row level security;

-- Staff: the code for one player. p_fresh = true makes a new code, and the old one stops working.
create or replace function public.player_invite(p_player text, p_fresh boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_code text; v_at timestamptz; v_b bytea;
begin
  if (select public.my_role()) is null then raise exception 'not_staff'; end if;
  if not exists (select 1 from public.docs where path = 'academy/data/players/' || p_player) then raise exception 'no_player'; end if;
  if not p_fresh then
    select i.code, i.created_at into v_code, v_at from public.player_invites i
      where i.player_id = p_player and i.created_at > now() - interval '7 days';
    if v_code is not null then
      return jsonb_build_object('code', v_code, 'expiresAt', v_at + interval '7 days');
    end if;
  end if;
  loop
    -- gen_random_uuid() is a strong random source built into Postgres; its first 4 bytes are random.
    v_b := uuid_send(gen_random_uuid());
    v_code := ((get_byte(v_b, 0)::bigint * 16777216 + get_byte(v_b, 1) * 65536 + get_byte(v_b, 2) * 256 + get_byte(v_b, 3)) % 900000 + 100000)::text;
    begin
      insert into public.player_invites as i (player_id, code, created_by) values (p_player, v_code, (select auth.uid()))
        on conflict (player_id) do update set code = excluded.code, created_by = excluded.created_by, created_at = now();
      return jsonb_build_object('code', v_code, 'expiresAt', now() + interval '7 days');
    exception when unique_violation then
      -- that code belongs to another player: draw again
    end;
  end loop;
end $$;

-- The read-only copy of one child's data that a linked parent reads (same shape the coaches' apps write,
-- minus edited drills). Coaches' apps replace it with the full copy on their next sync.
create or replace function public.family_copy(p_player text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'player', (select d.data from public.docs d where d.path = 'academy/data/players/' || p_player) || jsonb_build_object('parentIds', '[]'::jsonb),
    'plans', coalesce((select jsonb_agg(d.data order by d.data ->> 'createdAt') from public.docs d
      where d.parent = 'academy/data/plans' and d.data ->> 'playerId' = p_player
        and (d.data ->> 'owner' = 'coach' or coalesce(d.data ->> 'sharedWithCoachId', '') <> '')), '[]'::jsonb),
    'logs', coalesce((select jsonb_agg(x.data order by x.data ->> 'date', x.data ->> 'createdAt') from (
      select d.data from public.docs d where d.parent = 'academy/data/logs' and d.data ->> 'playerId' = p_player
      order by d.data ->> 'date' desc, d.data ->> 'createdAt' desc limit 400) x), '[]'::jsonb),
    'tournaments', coalesce((select jsonb_agg(d.data order by d.data ->> 'start') from public.docs d
      where d.parent = 'academy/data/tournaments' and d.data ->> 'playerId' = p_player), '[]'::jsonb),
    'matches', coalesce((select jsonb_agg(x.data order by x.data ->> 'date', x.data ->> 'createdAt') from (
      select d.data from public.docs d where d.parent = 'academy/data/matches' and d.data ->> 'playerId' = p_player
      order by d.data ->> 'date' desc, d.data ->> 'createdAt' desc limit 80) x), '[]'::jsonb),
    'drills', '[]'::jsonb,
    'paywall', coalesce((select d.data -> 'paywall' from public.docs d where d.path = 'academy/config'), 'false'::jsonb),
    'access', coalesce((select jsonb_object_agg(d.data ->> 'id', d.data -> 'access') from public.docs d
      where d.parent = 'academy/library/drills' and d.data ->> 'access' in ('free', 'pro')), '{}'::jsonb)
  )
$$;

-- Parents: follow the player behind a coach's code. Returns {playerId, name} or {error}.
-- (Errors are returned, not raised, so a wrong code is still counted.)
create or replace function public.redeem_player_invite(p_code text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_player text;
  v_doc jsonb;
begin
  if v_uid is null then return jsonb_build_object('error', 'not_signed_in'); end if;
  if (select public.my_role()) is not null then return jsonb_build_object('error', 'staff_account'); end if;
  if (select count(*) from public.invite_attempts a where a.user_id = v_uid and a.at > now() - interval '1 hour') >= 10 then
    return jsonb_build_object('error', 'too_many_attempts');
  end if;
  select i.player_id into v_player from public.player_invites i
    where i.code = btrim(p_code) and i.created_at > now() - interval '7 days';
  if v_player is not null then
    select d.data into v_doc from public.docs d where d.path = 'academy/data/players/' || v_player;
  end if;
  if v_doc is null then
    insert into public.invite_attempts (user_id) values (v_uid);
    return jsonb_build_object('error', 'invalid_code');
  end if;
  -- Link: the coaches' apps keep this parent's copy up to date from now on.
  if not (coalesce(v_doc -> 'parentIds', '[]'::jsonb) ? v_uid::text) then
    update public.docs d set data = jsonb_set(d.data, '{parentIds}', coalesce(d.data -> 'parentIds', '[]'::jsonb) || to_jsonb(v_uid::text))
      where d.path = 'academy/data/players/' || v_player;
  end if;
  -- First copy now, so the child appears at once even when no coach has the app open.
  insert into public.docs (path, data) values ('family/' || v_uid::text || '/players/' || v_player, public.family_copy(v_player))
    on conflict (path) do nothing;
  return jsonb_build_object('playerId', v_player, 'name', v_doc ->> 'name');
end $$;

revoke all on function public.player_invite(text, boolean), public.redeem_player_invite(text), public.family_copy(text) from public, anon, authenticated;
grant execute on function public.player_invite(text, boolean), public.redeem_player_invite(text) to authenticated;
