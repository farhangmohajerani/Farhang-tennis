-- 21GRAM Tennis — usernames and connections.
-- Run once in Supabase → SQL Editor → New query → paste → Run (after the other files). Safe to run again.
--
-- Everyone signs up as a coach or a family (one family account = one player) and picks a username.
-- A coach finds a player by username and sends a request; a family finds a coach the same way. When
-- the other side accepts, they are connected: the coach plans for the player, the family follows the
-- plan, and both follow (and chart) live matches. A coach sees only connected players and the players
-- they added themselves (players without an account). The admin (staff table) sees everything.
-- A family account's player documents use the account id as the player id.
-- Nothing here removes the earlier rules: they still give the admin full access.

create table if not exists public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  username text not null unique check (username ~ '^[a-z0-9][a-z0-9_.]{2,23}$'),
  display_name text not null check (char_length(btrim(display_name)) between 1 and 60),
  kind text not null check (kind in ('coach', 'family')),
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

create table if not exists public.connections (
  coach_id uuid not null references auth.users (id) on delete cascade,
  family_id uuid not null references auth.users (id) on delete cascade,
  status text not null check (status in ('pending', 'accepted', 'declined', 'removed')),
  requested_by text not null check (requested_by in ('coach', 'family')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  primary key (coach_id, family_id)
);
create index if not exists connections_family_idx on public.connections (family_id);
alter table public.connections enable row level security;

-- Both tables are reached only through the functions below.
do $$
declare t text;
begin
  foreach t in array array['profiles', 'connections'] loop
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = 'no_direct_access') then
      execute format('create policy no_direct_access on public.%I for all to authenticated using (false) with check (false)', t);
    end if;
  end loop;
end $$;

-- ---------- helpers used by the access rules ----------

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.staff s where s.user_id = (select auth.uid()) and s.role = 'admin')
$$;

create or replace function public.my_kind() returns text
language sql stable security definer set search_path = '' as $$
  select p.kind from public.profiles p where p.user_id = (select auth.uid())
$$;

-- Account player ids are account ids (uuid); players added by a coach have other ids.
create or replace function public.is_account_id(p text) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(p ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', false)
$$;

-- The player a document belongs to (null for the library, settings and older family copies).
create or replace function public.doc_player(p_path text, p_data jsonb) returns text
language sql immutable set search_path = '' as $$
  select case
    when p_path like 'academy/data/players/%' then split_part(p_path, '/', 4)
    when p_path ~ '^academy/data/(plans|logs|tournaments|matches)/' then p_data ->> 'playerId'
  end
$$;

-- A coach may work with a player who accepted them, or a player (without an account) they added.
create or replace function public.can_coach_player(p_player text) returns boolean
language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null and p_player is not null and (
    (public.is_account_id(p_player) and exists (
      select 1 from public.connections c
      where c.coach_id = (select auth.uid()) and c.family_id::text = p_player and c.status = 'accepted'))
    or (not public.is_account_id(p_player) and exists (
      select 1 from public.docs d
      where d.path = 'academy/data/players/' || p_player
        and d.data ->> 'ownerId' = (select auth.uid())::text
        and d.data -> 'archived' is distinct from 'true'::jsonb))
  )
$$;

-- A family sees their own player; a coach sees the players they may work with.
create or replace function public.can_see_player(p_player text) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_player is not null and (p_player = (select auth.uid())::text or public.can_coach_player(p_player))
$$;

-- ---------- access rules on documents (added beside the admin rules) ----------

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'docs' and policyname = 'social_read') then
    create policy social_read on public.docs for select to authenticated using (
      path like 'academy/library/%' or path = 'academy/config'
      or (path like 'academy/data/%' and public.can_see_player(public.doc_player(path, data)))
      -- the coach's own player without an account, also while it is being created (upserts must see the new row)
      or (path like 'academy/data/players/%' and not public.is_account_id(split_part(path, '/', 4))
          and data ->> 'ownerId' = (select auth.uid())::text and data -> 'archived' is distinct from 'true'::jsonb));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'docs' and policyname = 'social_insert') then
    create policy social_insert on public.docs for insert to authenticated with check (
      path like 'academy/data/%' and (
        public.can_coach_player(public.doc_player(path, data))
        or (path like 'academy/data/players/%' and not public.is_account_id(split_part(path, '/', 4))
            and data ->> 'ownerId' = (select auth.uid())::text and public.my_kind() = 'coach')));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'docs' and policyname = 'social_update') then
    create policy social_update on public.docs for update to authenticated
      using (path like 'academy/data/%' and public.can_coach_player(public.doc_player(path, data)))
      with check (path like 'academy/data/%' and public.can_coach_player(public.doc_player(path, data)));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'docs' and policyname = 'social_delete') then
    create policy social_delete on public.docs for delete to authenticated using (
      path like 'academy/data/%'
      and not (path like 'academy/data/players/%' and public.is_account_id(split_part(path, '/', 4)))
      and public.can_coach_player(public.doc_player(path, data)));
  end if;
end $$;

-- ---------- profiles ----------

create or replace function public.my_profile() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('username', p.username, 'displayName', p.display_name, 'kind', p.kind)
  from public.profiles p where p.user_id = (select auth.uid())
$$;

create or replace function public.username_available(p_username text) returns boolean
language sql stable security definer set search_path = '' as $$
  select lower(btrim(coalesce(p_username, ''))) ~ '^[a-z0-9][a-z0-9_.]{2,23}$'
     and not exists (select 1 from public.profiles p where p.username = lower(btrim(p_username)))
$$;

-- Once per account: username, name, coach or family. A family account gets its player at once.
create or replace function public.register_profile(
  p_username text, p_display_name text, p_kind text,
  p_birth_year int default null, p_hand text default null, p_backhand text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_username text := lower(btrim(coalesce(p_username, '')));
  v_name text := btrim(coalesce(p_display_name, ''));
  v_year int := extract(year from now())::int;
begin
  if v_uid is null then return jsonb_build_object('error', 'not_signed_in'); end if;
  if exists (select 1 from public.profiles where user_id = v_uid) then return jsonb_build_object('error', 'exists'); end if;
  if v_username !~ '^[a-z0-9][a-z0-9_.]{2,23}$' then return jsonb_build_object('error', 'bad_username'); end if;
  if char_length(v_name) not between 1 and 60 then return jsonb_build_object('error', 'bad_name'); end if;
  if p_kind not in ('coach', 'family') then return jsonb_build_object('error', 'bad_kind'); end if;
  if exists (select 1 from public.profiles where username = v_username) then return jsonb_build_object('error', 'username_taken'); end if;
  begin
    insert into public.profiles (user_id, username, display_name, kind) values (v_uid, v_username, v_name, p_kind);
  exception when unique_violation then
    return jsonb_build_object('error', 'username_taken');
  end;
  if p_kind = 'family' then
    insert into public.docs (path, data) values ('academy/data/players/' || v_uid::text, jsonb_build_object(
      'id', v_uid::text, 'name', v_name,
      'birthYear', case when p_birth_year between v_year - 90 and v_year - 3 then p_birth_year else v_year - 12 end,
      'level', 'beginner',
      'hand', case when p_hand in ('right', 'left') then p_hand else 'right' end,
      'backhand', case when p_backhand in ('one', 'two') then p_backhand else 'two' end,
      'coachId', '', 'parentId', '', 'parentIds', '[]'::jsonb, 'goals', '',
      'accountId', v_uid::text, 'username', v_username))
    on conflict (path) do nothing;
  end if;
  return jsonb_build_object('ok', true, 'username', v_username);
end $$;

-- ---------- finding each other and connecting ----------

-- Coaches find players (family accounts), families find coaches: username or name, from 2 letters.
create or replace function public.search_profiles(p_query text)
returns table (username text, display_name text, kind text, status text, direction text)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_kind text := public.my_kind();
  v_q text := lower(btrim(coalesce(p_query, '')));
begin
  -- Letters, digits, '.', '_' and spaces only, then at least 2 of them; '_' is matched literally.
  v_q := btrim(regexp_replace(v_q, '[^[:alnum:]_. ]', '', 'g'));
  if v_uid is null or v_kind is null or char_length(v_q) < 2 then return; end if;
  v_q := replace(v_q, '_', '\_');
  return query
    select p.username, p.display_name, p.kind,
           case when c.status in ('pending', 'accepted') then c.status end,
           case when c.status in ('pending', 'accepted') then (case when c.requested_by = v_kind then 'out' else 'in' end) end
    from public.profiles p
    left join public.connections c
      on (v_kind = 'coach' and c.coach_id = v_uid and c.family_id = p.user_id)
      or (v_kind = 'family' and c.family_id = v_uid and c.coach_id = p.user_id)
    where p.kind <> v_kind and p.user_id <> v_uid
      and (p.username like v_q || '%' or lower(p.display_name) like v_q || '%' or lower(p.display_name) like '% ' || v_q || '%')
    order by (p.username = v_q) desc, p.username
    limit 20;
end $$;

-- Ask to connect (coach → player, or family → coach). If they already asked you, this accepts.
create or replace function public.send_request(p_username text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_kind text := public.my_kind();
  v_target public.profiles;
  v_coach uuid; v_family uuid;
  v_row public.connections;
begin
  if v_uid is null then return jsonb_build_object('error', 'not_signed_in'); end if;
  if v_kind is null then return jsonb_build_object('error', 'no_profile'); end if;
  select * into v_target from public.profiles where username = lower(btrim(coalesce(p_username, '')));
  if v_target.user_id is null or v_target.user_id = v_uid then return jsonb_build_object('error', 'not_found'); end if;
  if v_target.kind = v_kind then return jsonb_build_object('error', 'same_kind'); end if;
  v_coach := case when v_kind = 'coach' then v_uid else v_target.user_id end;
  v_family := case when v_kind = 'family' then v_uid else v_target.user_id end;
  select * into v_row from public.connections where coach_id = v_coach and family_id = v_family;
  if v_row.status = 'accepted' then return jsonb_build_object('status', 'accepted'); end if;
  if v_row.status = 'pending' and v_row.requested_by <> v_kind then
    update public.connections set status = 'accepted', responded_at = now() where coach_id = v_coach and family_id = v_family;
    return jsonb_build_object('status', 'accepted');
  end if;
  if v_row.status = 'pending' then return jsonb_build_object('status', 'pending'); end if;
  if (select count(*) from public.connections c
      where c.created_at > now() - interval '1 hour' and c.requested_by = v_kind
        and ((v_kind = 'coach' and c.coach_id = v_uid) or (v_kind = 'family' and c.family_id = v_uid))) >= 30 then
    return jsonb_build_object('error', 'too_many');
  end if;
  insert into public.connections (coach_id, family_id, status, requested_by, created_at, responded_at)
    values (v_coach, v_family, 'pending', v_kind, now(), null)
    on conflict (coach_id, family_id) do update set status = 'pending', requested_by = excluded.requested_by, created_at = now(), responded_at = null;
  return jsonb_build_object('status', 'pending');
end $$;

-- Accept or decline a request the other side sent you.
create or replace function public.respond_request(p_username text, p_accept boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_kind text := public.my_kind();
  v_other uuid;
  v_n int;
begin
  if v_uid is null or v_kind is null then return jsonb_build_object('error', 'no_profile'); end if;
  select user_id into v_other from public.profiles where username = lower(btrim(coalesce(p_username, ''))) and kind <> v_kind;
  if v_other is null then return jsonb_build_object('error', 'not_found'); end if;
  update public.connections set status = case when p_accept then 'accepted' else 'declined' end, responded_at = now()
    where status = 'pending' and requested_by <> v_kind
      and coach_id = case when v_kind = 'coach' then v_uid else v_other end
      and family_id = case when v_kind = 'family' then v_uid else v_other end;
  get diagnostics v_n = row_count;
  if v_n = 0 then return jsonb_build_object('error', 'not_found'); end if;
  return jsonb_build_object('status', case when p_accept then 'accepted' else 'declined' end);
end $$;

-- Either side ends a connection or withdraws a request; access stops at once.
create or replace function public.remove_connection(p_username text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_kind text := public.my_kind();
  v_other uuid;
begin
  if v_uid is null or v_kind is null then return jsonb_build_object('error', 'no_profile'); end if;
  select user_id into v_other from public.profiles where username = lower(btrim(coalesce(p_username, ''))) and kind <> v_kind;
  if v_other is null then return jsonb_build_object('error', 'not_found'); end if;
  update public.connections set status = 'removed', responded_at = now()
    where status in ('pending', 'accepted')
      and coach_id = case when v_kind = 'coach' then v_uid else v_other end
      and family_id = case when v_kind = 'family' then v_uid else v_other end;
  return jsonb_build_object('status', 'removed');
end $$;

-- Your connections and open requests. player_id is the player's id (for a coach: the family's player).
create or replace function public.my_connections()
returns table (username text, display_name text, kind text, status text, direction text, player_id text, since timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_kind text := public.my_kind();
begin
  if v_uid is null or v_kind is null then return; end if;
  return query
    select p.username, p.display_name, p.kind, c.status,
           case when c.requested_by = v_kind then 'out' else 'in' end,
           c.family_id::text, coalesce(c.responded_at, c.created_at)
    from public.connections c
    join public.profiles p on p.user_id = case when v_kind = 'coach' then c.family_id else c.coach_id end
    where c.status in ('pending', 'accepted')
      and ((v_kind = 'coach' and c.coach_id = v_uid) or (v_kind = 'family' and c.family_id = v_uid))
    order by c.status desc, p.username;
end $$;

-- A coach links a player they added (without an account) to that player's new family account:
-- plans, results, tournaments and matches move over; the old entry is archived.
create or replace function public.merge_offline_player(p_offline text, p_username text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_admin boolean := public.is_admin();
  v_off jsonb;
  v_family uuid;
  v_n int;
begin
  if v_uid is null then return jsonb_build_object('error', 'not_signed_in'); end if;
  if public.is_account_id(p_offline) then return jsonb_build_object('error', 'not_offline'); end if;
  select d.data into v_off from public.docs d where d.path = 'academy/data/players/' || p_offline;
  if v_off is null or v_off -> 'archived' = 'true'::jsonb or (not v_admin and v_off ->> 'ownerId' is distinct from v_uid::text) then
    return jsonb_build_object('error', 'not_found');
  end if;
  select user_id into v_family from public.profiles where username = lower(btrim(coalesce(p_username, ''))) and kind = 'family';
  if v_family is null then return jsonb_build_object('error', 'not_found'); end if;
  if not v_admin and not exists (select 1 from public.connections where coach_id = v_uid and family_id = v_family and status = 'accepted') then
    return jsonb_build_object('error', 'not_connected');
  end if;
  update public.docs set data = jsonb_set(data, '{playerId}', to_jsonb(v_family::text))
    where path ~ '^academy/data/(plans|logs|tournaments|matches)/' and data ->> 'playerId' = p_offline;
  get diagnostics v_n = row_count;
  -- The coach's level and goals carry over; the family keeps its name and account.
  update public.docs set data = data || jsonb_build_object('level', v_off -> 'level', 'goals', v_off -> 'goals')
    where path = 'academy/data/players/' || v_family::text and v_off ? 'level';
  update public.docs set data = data || jsonb_build_object('archived', true, 'mergedInto', v_family::text)
    where path = 'academy/data/players/' || p_offline;
  return jsonb_build_object('ok', true, 'moved', v_n);
end $$;

-- A family charts the live score of their own player's matches (only matches they charted).
create or replace function public.family_save_match(p_match jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_id text;
  v_old jsonb;
begin
  if v_uid is null then return jsonb_build_object('error', 'not_signed_in'); end if;
  if public.my_kind() is distinct from 'family' then return jsonb_build_object('error', 'not_family'); end if;
  if p_match is null or jsonb_typeof(p_match) <> 'object' then return jsonb_build_object('error', 'bad_match'); end if;
  v_id := p_match ->> 'id';
  if v_id is null or v_id !~ '^[A-Za-z0-9_.~:@+-]{1,100}$' then return jsonb_build_object('error', 'bad_match'); end if;
  if p_match ->> 'playerId' is distinct from v_uid::text then return jsonb_build_object('error', 'not_linked'); end if;
  if jsonb_typeof(coalesce(p_match -> 'points', '[]'::jsonb)) <> 'array' or pg_column_size(p_match) > 300000
     or jsonb_array_length(coalesce(p_match -> 'points', '[]'::jsonb)) > 3000 then
    return jsonb_build_object('error', 'too_big');
  end if;
  select d.data into v_old from public.docs d where d.path = 'academy/data/matches/' || v_id;
  if v_old is not null and (v_old ->> 'playerId' is distinct from v_uid::text or coalesce(v_old ->> 'scorerId', '') <> v_uid::text) then
    return jsonb_build_object('error', 'not_scorer');
  end if;
  insert into public.docs (path, data)
    values ('academy/data/matches/' || v_id, p_match || jsonb_build_object('scorerId', v_uid::text, 'scorerRole', 'parent', 'ai', coalesce(v_old -> 'ai', 'null'::jsonb)))
    on conflict (path) do update set data = excluded.data;
  return jsonb_build_object('ok', true);
end $$;

-- Admin: everyone, with their email and how many connections they have.
create or replace function public.admin_profiles()
returns table (user_id uuid, username text, display_name text, kind text, email text, created_at timestamptz, connections int)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then return; end if;
  return query
    select p.user_id, p.username, p.display_name, p.kind, u.email::text, p.created_at,
           (select count(*)::int from public.connections c where c.status = 'accepted' and (c.coach_id = p.user_id or c.family_id = p.user_id))
    from public.profiles p join auth.users u on u.id = p.user_id
    order by p.kind, p.username;
end $$;

revoke all on function
  public.my_profile(), public.username_available(text), public.register_profile(text, text, text, int, text, text),
  public.search_profiles(text), public.send_request(text), public.respond_request(text, boolean), public.remove_connection(text),
  public.my_connections(), public.merge_offline_player(text, text), public.admin_profiles()
  from public, anon;
grant execute on function
  public.my_profile(), public.username_available(text), public.register_profile(text, text, text, int, text, text),
  public.search_profiles(text), public.send_request(text), public.respond_request(text, boolean), public.remove_connection(text),
  public.my_connections(), public.merge_offline_player(text, text), public.admin_profiles()
  to authenticated;
-- Used inside the access rules, so signed-in users need them; they only answer about the caller.
revoke all on function public.is_admin(), public.my_kind(), public.can_coach_player(text), public.can_see_player(text) from public, anon;
grant execute on function public.is_admin(), public.my_kind(), public.can_coach_player(text), public.can_see_player(text) to authenticated;

-- The earlier ways in (staff coaches, invite and pairing codes) are replaced by usernames and requests.
revoke execute on function public.approve_coach(uuid, text), public.request_coach(), public.player_invite(text, boolean),
  public.redeem_player_invite(text), public.my_pair_code(), public.resolve_pair_code(text) from authenticated;
do $$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'staff_invite') then
    execute 'revoke execute on function public.staff_invite(text, text), public.claim_staff_code(text) from authenticated';
  end if;
end $$;
