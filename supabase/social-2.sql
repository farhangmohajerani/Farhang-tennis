-- 21GRAM Tennis — consents, privacy, moderation, approvals and match notifications.
-- Run after supabase/social.sql (SQL Editor → New query → paste → Run). Safe to run again; nothing here
-- removes data.
--
--  * Sign-up records the privacy consent and, for a family, that a parent or guardian made the account.
--  * Families are found only by their exact username, unless they choose to be found by name.
--  * After a family declines or disconnects a coach, that coach can ask again only after 30 days.
--  * A coach moves a player without an account into a family account only when the family allows it.
--  * Only whoever created a plan, result, tournament or match can delete it; families can delete
--    (hide) the matches they charted themselves.
--  * The admin can mark coaches as verified and block accounts.
--  * Push notifications: devices register here; the notify Edge Function sends "match started" and keeps
--    its own keys (table app_keys, readable only by the server).

-- ---------- columns ----------
alter table public.profiles add column if not exists discoverable boolean not null default false;
alter table public.profiles add column if not exists blocked boolean not null default false;
alter table public.profiles add column if not exists verified boolean not null default false;
alter table public.profiles add column if not exists notify_live boolean not null default true;
alter table public.profiles add column if not exists guardian boolean not null default false;
alter table public.profiles add column if not exists consent_version text;
alter table public.profiles add column if not exists consent_at timestamptz;
alter table public.connections add column if not exists closed_by text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'connections_closed_by_check') then
    alter table public.connections add constraint connections_closed_by_check check (closed_by in ('coach', 'family', 'admin'));
  end if;
end $$;

-- ---------- tables ----------
create table if not exists public.link_requests (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references auth.users (id) on delete cascade,
  family_id uuid not null references auth.users (id) on delete cascade,
  offline_id text not null,
  offline_name text not null,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'cancelled')),
  created_at timestamptz not null default now(),
  responded_at timestamptz
);
create unique index if not exists link_requests_one_open on public.link_requests (offline_id) where status = 'pending';
create index if not exists link_requests_family_idx on public.link_requests (family_id);
create index if not exists link_requests_coach_idx on public.link_requests (coach_id);
alter table public.link_requests enable row level security;

create table if not exists public.push_subscriptions (
  endpoint text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  p256dh text not null,
  auth text not null,
  lang text not null default 'en',
  user_agent text,
  created_at timestamptz not null default now(),
  disabled_at timestamptz
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;

-- One "match started" notification per match (written by the notify Edge Function).
create table if not exists public.match_notifications (
  match_id text primary key,
  sent_by uuid references auth.users (id) on delete set null,
  sent_at timestamptz not null default now()
);
create index if not exists match_notifications_sent_by_idx on public.match_notifications (sent_by);
alter table public.match_notifications enable row level security;

-- Keys the notify Edge Function keeps for itself: its Web Push (VAPID) key pair, made there on first use
-- so the private key never leaves the server, and the app's address used in notifications.
create table if not exists public.app_keys (
  name text primary key,
  value text not null,
  created_at timestamptz not null default now()
);
alter table public.app_keys enable row level security;
-- The address notifications open (change it if the app moves).
insert into public.app_keys (name, value) values ('app_url', 'https://farhangmohajerani.github.io/Farhang-tennis/')
  on conflict (name) do nothing;

do $$
declare t text;
begin
  foreach t in array array['link_requests', 'push_subscriptions', 'match_notifications', 'app_keys'] loop
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = 'no_direct_access') then
      execute format('create policy no_direct_access on public.%I for all to authenticated using (false) with check (false)', t);
    end if;
  end loop;
end $$;

-- ---------- helpers ----------
create or replace function public.me_blocked() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select p.blocked from public.profiles p where p.user_id = (select auth.uid())), false)
$$;

-- A blocked coach loses access to every player.
create or replace function public.can_coach_player(p_player text) returns boolean
language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null and p_player is not null and not public.me_blocked() and (
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

-- Who created a document never changes.
create or replace function public.keep_created_by() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.data ? 'createdBy' then
    new.data := jsonb_set(new.data, '{createdBy}', old.data -> 'createdBy');
  end if;
  return new;
end $$;
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'docs_keep_created_by' and tgrelid = 'public.docs'::regclass) then
    create trigger docs_keep_created_by before update on public.docs for each row execute function public.keep_created_by();
  end if;
end $$;

-- A blocked coach also stops seeing the players they added themselves.
alter policy social_read on public.docs using (
  path like 'academy/library/%' or path = 'academy/config'
  or (path like 'academy/data/%' and public.can_see_player(public.doc_player(path, data)))
  or (path like 'academy/data/players/%' and not public.is_account_id(split_part(path, '/', 4))
      and data ->> 'ownerId' = (select auth.uid())::text and data -> 'archived' is distinct from 'true'::jsonb
      and not public.me_blocked()));

-- New documents name their creator truthfully; only the creator deletes (documents from before this have no creator).
alter policy social_insert on public.docs with check (
  path like 'academy/data/%'
  and (data ->> 'createdBy' is null or data ->> 'createdBy' = (select auth.uid())::text)
  and (
    public.can_coach_player(public.doc_player(path, data))
    or (path like 'academy/data/players/%' and not public.is_account_id(split_part(path, '/', 4))
        and data ->> 'ownerId' = (select auth.uid())::text and public.my_kind() = 'coach' and not public.me_blocked())));
alter policy social_delete on public.docs using (
  path like 'academy/data/%'
  and not (path like 'academy/data/players/%' and public.is_account_id(split_part(path, '/', 4)))
  and (data ->> 'createdBy' is null or data ->> 'createdBy' = (select auth.uid())::text)
  and public.can_coach_player(public.doc_player(path, data)));

-- ---------- profile ----------
create or replace function public.my_profile() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('username', p.username, 'displayName', p.display_name, 'kind', p.kind,
    'discoverable', p.discoverable, 'notifyLive', p.notify_live, 'verified', p.verified, 'blocked', p.blocked,
    'guardian', p.guardian, 'consentAt', p.consent_at)
  from public.profiles p where p.user_id = (select auth.uid())
$$;

-- Sign-up with consent: the privacy notice version, and for a family that a parent or guardian made it.
create or replace function public.register_profile_v2(
  p_username text, p_display_name text, p_kind text, p_birth_year int,
  p_discoverable boolean, p_guardian boolean, p_consent text
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
  if char_length(btrim(coalesce(p_consent, ''))) not between 1 and 40 then return jsonb_build_object('error', 'consent_required'); end if;
  if p_kind = 'family' and p_guardian is not true then return jsonb_build_object('error', 'guardian_required'); end if;
  if exists (select 1 from public.profiles where username = v_username) then return jsonb_build_object('error', 'username_taken'); end if;
  begin
    insert into public.profiles (user_id, username, display_name, kind, discoverable, guardian, consent_version, consent_at)
      values (v_uid, v_username, v_name, p_kind, case when p_kind = 'coach' then true else coalesce(p_discoverable, false) end,
              p_kind = 'family', btrim(p_consent), now());
  exception when unique_violation then
    return jsonb_build_object('error', 'username_taken');
  end;
  if p_kind = 'family' then
    insert into public.docs (path, data) values ('academy/data/players/' || v_uid::text, jsonb_build_object(
      'id', v_uid::text, 'name', v_name,
      'birthYear', case when p_birth_year between v_year - 90 and v_year - 3 then p_birth_year else v_year - 12 end,
      'level', 'beginner', 'hand', 'right', 'backhand', 'two',
      'coachId', '', 'parentId', '', 'parentIds', '[]'::jsonb, 'goals', '',
      'accountId', v_uid::text, 'username', v_username, 'aiConsent', false))
    on conflict (path) do nothing;
  end if;
  return jsonb_build_object('ok', true, 'username', v_username);
end $$;

-- Accounts made before consent was asked give it once, at their next sign-in.
create or replace function public.give_consent(p_guardian boolean, p_consent text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_kind text := public.my_kind();
begin
  if v_uid is null or v_kind is null then return jsonb_build_object('error', 'no_profile'); end if;
  if char_length(btrim(coalesce(p_consent, ''))) not between 1 and 40 then return jsonb_build_object('error', 'consent_required'); end if;
  if v_kind = 'family' and p_guardian is not true then return jsonb_build_object('error', 'guardian_required'); end if;
  update public.profiles set consent_version = btrim(p_consent), consent_at = now(), guardian = (v_kind = 'family')
    where user_id = v_uid;
  return jsonb_build_object('ok', true);
end $$;

-- Name, being found by name (families) and match notifications.
create or replace function public.update_my_profile(p_display_name text default null, p_discoverable boolean default null, p_notify_live boolean default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_kind text := public.my_kind(); v_name text := btrim(coalesce(p_display_name, ''));
begin
  if v_uid is null or v_kind is null then return jsonb_build_object('error', 'no_profile'); end if;
  if p_display_name is not null and char_length(v_name) not between 1 and 60 then return jsonb_build_object('error', 'bad_name'); end if;
  update public.profiles set
    display_name = case when p_display_name is null then display_name else v_name end,
    discoverable = case when v_kind = 'coach' then true when p_discoverable is null then discoverable else p_discoverable end,
    notify_live = coalesce(p_notify_live, notify_live)
  where user_id = v_uid;
  if v_kind = 'family' and p_display_name is not null then
    update public.docs set data = data || jsonb_build_object('name', v_name) where path = 'academy/data/players/' || v_uid::text;
  end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.change_username(p_username text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_kind text := public.my_kind(); v_username text := lower(btrim(coalesce(p_username, '')));
begin
  if v_uid is null or v_kind is null then return jsonb_build_object('error', 'no_profile'); end if;
  if v_username !~ '^[a-z0-9][a-z0-9_.]{2,23}$' then return jsonb_build_object('error', 'bad_username'); end if;
  if exists (select 1 from public.profiles where username = v_username and user_id <> v_uid) then return jsonb_build_object('error', 'username_taken'); end if;
  begin
    update public.profiles set username = v_username where user_id = v_uid;
  exception when unique_violation then
    return jsonb_build_object('error', 'username_taken');
  end;
  if v_kind = 'family' then
    update public.docs set data = data || jsonb_build_object('username', v_username) where path = 'academy/data/players/' || v_uid::text;
  end if;
  return jsonb_build_object('ok', true, 'username', v_username);
end $$;

-- A family edits their player's own details and the AI-analysis choice (coaches edit level and goals).
create or replace function public.family_update_player(p_patch jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_year int := extract(year from now())::int;
  v_clean jsonb := '{}'::jsonb;
  v_name text;
begin
  if v_uid is null or public.my_kind() is distinct from 'family' then return jsonb_build_object('error', 'not_family'); end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then return jsonb_build_object('error', 'bad_patch'); end if;
  if p_patch ? 'name' then
    v_name := btrim(coalesce(p_patch ->> 'name', ''));
    if char_length(v_name) not between 1 and 60 then return jsonb_build_object('error', 'bad_name'); end if;
    v_clean := v_clean || jsonb_build_object('name', v_name);
  end if;
  if p_patch ? 'birthYear' then
    if jsonb_typeof(p_patch -> 'birthYear') <> 'number' or (p_patch ->> 'birthYear')::numeric not between v_year - 90 and v_year - 3 then
      return jsonb_build_object('error', 'bad_year');
    end if;
    v_clean := v_clean || jsonb_build_object('birthYear', (p_patch ->> 'birthYear')::int);
  end if;
  if p_patch ? 'hand' then
    if p_patch ->> 'hand' not in ('right', 'left') then return jsonb_build_object('error', 'bad_hand'); end if;
    v_clean := v_clean || jsonb_build_object('hand', p_patch ->> 'hand');
  end if;
  if p_patch ? 'backhand' then
    if p_patch ->> 'backhand' not in ('one', 'two') then return jsonb_build_object('error', 'bad_backhand'); end if;
    v_clean := v_clean || jsonb_build_object('backhand', p_patch ->> 'backhand');
  end if;
  if p_patch ? 'aiConsent' then
    if jsonb_typeof(p_patch -> 'aiConsent') <> 'boolean' then return jsonb_build_object('error', 'bad_consent'); end if;
    v_clean := v_clean || jsonb_build_object('aiConsent', p_patch -> 'aiConsent');
  end if;
  update public.docs set data = data || v_clean where path = 'academy/data/players/' || v_uid::text;
  if v_name is not null then update public.profiles set display_name = v_name where user_id = v_uid; end if;
  return jsonb_build_object('ok', true);
end $$;

-- ---------- finding each other ----------
-- Coaches are found by name or username. Families only by their exact username, unless they chose to be
-- found by name. Blocked accounts are never listed.
create or replace function public.search_people(p_query text)
returns table (username text, display_name text, kind text, verified boolean, status text, direction text)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_kind text := public.my_kind();
  v_q text := lower(btrim(coalesce(p_query, '')));
  v_like text;
begin
  v_q := btrim(regexp_replace(v_q, '[^[:alnum:]_. ]', '', 'g'));
  if v_uid is null or v_kind is null or char_length(v_q) < 2 or public.me_blocked() then return; end if;
  v_like := replace(v_q, '_', '\_');
  return query
    select p.username, p.display_name, p.kind, p.verified,
           case when c.status in ('pending', 'accepted') then c.status end,
           case when c.status in ('pending', 'accepted') then (case when c.requested_by = v_kind then 'out' else 'in' end) end
    from public.profiles p
    left join public.connections c
      on (v_kind = 'coach' and c.coach_id = v_uid and c.family_id = p.user_id)
      or (v_kind = 'family' and c.family_id = v_uid and c.coach_id = p.user_id)
    where p.kind <> v_kind and p.user_id <> v_uid and not p.blocked
      and (p.username = v_q
           or ((p.kind = 'coach' or p.discoverable)
               and (p.username like v_like || '%' or lower(p.display_name) like v_like || '%' or lower(p.display_name) like '% ' || v_like || '%')))
    order by (p.username = v_q) desc, p.verified desc, p.username
    limit 20;
end $$;

-- The earlier search follows the same privacy rules (for apps that have not reloaded yet).
create or replace function public.search_profiles(p_query text)
returns table (username text, display_name text, kind text, status text, direction text)
language sql stable security definer set search_path = '' as $$
  select s.username, s.display_name, s.kind, s.status, s.direction from public.search_people(p_query) s
$$;

-- Ask to connect. After the other side declined or disconnected, the same request waits 30 days.
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
  if public.me_blocked() then return jsonb_build_object('error', 'blocked'); end if;
  select * into v_target from public.profiles where username = lower(btrim(coalesce(p_username, '')));
  if v_target.user_id is null or v_target.user_id = v_uid or v_target.blocked then return jsonb_build_object('error', 'not_found'); end if;
  if v_target.kind = v_kind then return jsonb_build_object('error', 'same_kind'); end if;
  v_coach := case when v_kind = 'coach' then v_uid else v_target.user_id end;
  v_family := case when v_kind = 'family' then v_uid else v_target.user_id end;
  select * into v_row from public.connections where coach_id = v_coach and family_id = v_family;
  if v_row.status = 'accepted' then return jsonb_build_object('status', 'accepted'); end if;
  if v_row.status = 'pending' and v_row.requested_by <> v_kind then
    update public.connections set status = 'accepted', responded_at = now(), closed_by = null where coach_id = v_coach and family_id = v_family;
    return jsonb_build_object('status', 'accepted');
  end if;
  if v_row.status = 'pending' then return jsonb_build_object('status', 'pending'); end if;
  if v_row.status in ('declined', 'removed') and v_row.closed_by is not null and v_row.closed_by <> v_kind
     and v_row.responded_at > now() - interval '30 days' then
    return jsonb_build_object('error', 'wait', 'until', v_row.responded_at + interval '30 days');
  end if;
  if (select count(*) from public.connections c
      where c.created_at > now() - interval '1 hour' and c.requested_by = v_kind
        and ((v_kind = 'coach' and c.coach_id = v_uid) or (v_kind = 'family' and c.family_id = v_uid))) >= 30 then
    return jsonb_build_object('error', 'too_many');
  end if;
  insert into public.connections (coach_id, family_id, status, requested_by, created_at, responded_at, closed_by)
    values (v_coach, v_family, 'pending', v_kind, now(), null, null)
    on conflict (coach_id, family_id) do update set status = 'pending', requested_by = excluded.requested_by, created_at = now(), responded_at = null, closed_by = null;
  return jsonb_build_object('status', 'pending');
end $$;

create or replace function public.respond_request(p_username text, p_accept boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_kind text := public.my_kind();
  v_other uuid;
  v_n int;
begin
  if v_uid is null or v_kind is null then return jsonb_build_object('error', 'no_profile'); end if;
  if public.me_blocked() then return jsonb_build_object('error', 'blocked'); end if;
  select user_id into v_other from public.profiles where username = lower(btrim(coalesce(p_username, ''))) and kind <> v_kind;
  if v_other is null then return jsonb_build_object('error', 'not_found'); end if;
  update public.connections set status = case when p_accept then 'accepted' else 'declined' end, responded_at = now(),
         closed_by = case when p_accept then null else v_kind end
    where status = 'pending' and requested_by <> v_kind
      and coach_id = case when v_kind = 'coach' then v_uid else v_other end
      and family_id = case when v_kind = 'family' then v_uid else v_other end;
  get diagnostics v_n = row_count;
  if v_n = 0 then return jsonb_build_object('error', 'not_found'); end if;
  return jsonb_build_object('status', case when p_accept then 'accepted' else 'declined' end);
end $$;

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
  update public.connections set status = 'removed', responded_at = now(), closed_by = v_kind
    where status in ('pending', 'accepted')
      and coach_id = case when v_kind = 'coach' then v_uid else v_other end
      and family_id = case when v_kind = 'family' then v_uid else v_other end;
  return jsonb_build_object('status', 'removed');
end $$;

create or replace function public.my_connections_v2()
returns table (username text, display_name text, kind text, verified boolean, status text, direction text, player_id text, since timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_kind text := public.my_kind();
begin
  if v_uid is null or v_kind is null then return; end if;
  return query
    select p.username, p.display_name, p.kind, p.verified, c.status,
           case when c.requested_by = v_kind then 'out' else 'in' end,
           c.family_id::text, coalesce(c.responded_at, c.created_at)
    from public.connections c
    join public.profiles p on p.user_id = case when v_kind = 'coach' then c.family_id else c.coach_id end
    where c.status in ('pending', 'accepted')
      and ((v_kind = 'coach' and c.coach_id = v_uid) or (v_kind = 'family' and c.family_id = v_uid))
    order by c.status desc, p.username;
end $$;

-- ---------- moving a player without an account into a family account (the family allows it) ----------
create or replace function public.do_merge_offline(p_offline text, p_family uuid) returns int
language plpgsql security definer set search_path = '' as $$
declare v_off jsonb; v_n int;
begin
  select d.data into v_off from public.docs d where d.path = 'academy/data/players/' || p_offline;
  update public.docs set data = jsonb_set(data, '{playerId}', to_jsonb(p_family::text))
    where path ~ '^academy/data/(plans|logs|tournaments|matches)/' and data ->> 'playerId' = p_offline;
  get diagnostics v_n = row_count;
  update public.docs set data = data || jsonb_build_object('level', v_off -> 'level', 'goals', v_off -> 'goals')
    where path = 'academy/data/players/' || p_family::text and v_off ? 'level';
  update public.docs set data = data || jsonb_build_object('archived', true, 'mergedInto', p_family::text)
    where path = 'academy/data/players/' || p_offline;
  return v_n;
end $$;
revoke all on function public.do_merge_offline(text, uuid) from public, anon, authenticated;

create or replace function public.request_link(p_offline text, p_username text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_off jsonb;
  v_family uuid;
  v_id uuid;
begin
  if v_uid is null or public.my_kind() is distinct from 'coach' or public.me_blocked() then return jsonb_build_object('error', 'not_allowed'); end if;
  if public.is_account_id(p_offline) then return jsonb_build_object('error', 'not_offline'); end if;
  select d.data into v_off from public.docs d where d.path = 'academy/data/players/' || p_offline;
  if v_off is null or v_off -> 'archived' = 'true'::jsonb or v_off ->> 'ownerId' is distinct from v_uid::text then
    return jsonb_build_object('error', 'not_found');
  end if;
  select user_id into v_family from public.profiles where username = lower(btrim(coalesce(p_username, ''))) and kind = 'family';
  if v_family is null then return jsonb_build_object('error', 'not_found'); end if;
  if not exists (select 1 from public.connections where coach_id = v_uid and family_id = v_family and status = 'accepted') then
    return jsonb_build_object('error', 'not_connected');
  end if;
  select id into v_id from public.link_requests where offline_id = p_offline and status = 'pending' and family_id = v_family;
  if v_id is not null then return jsonb_build_object('ok', true, 'id', v_id); end if;
  update public.link_requests set status = 'cancelled', responded_at = now() where offline_id = p_offline and status = 'pending';
  insert into public.link_requests (coach_id, family_id, offline_id, offline_name)
    values (v_uid, v_family, p_offline, coalesce(nullif(btrim(v_off ->> 'name'), ''), '—'))
    returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

create or replace function public.cancel_link(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_n int;
begin
  update public.link_requests set status = 'cancelled', responded_at = now()
    where id = p_id and status = 'pending' and coach_id = (select auth.uid());
  get diagnostics v_n = row_count;
  return case when v_n = 0 then jsonb_build_object('error', 'not_found') else jsonb_build_object('ok', true) end;
end $$;

create or replace function public.respond_link(p_id uuid, p_accept boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_row public.link_requests;
  v_off jsonb;
  v_n int := 0;
begin
  select * into v_row from public.link_requests where id = p_id and status = 'pending' and family_id = v_uid;
  if v_row.id is null then return jsonb_build_object('error', 'not_found'); end if;
  if not p_accept then
    update public.link_requests set status = 'declined', responded_at = now() where id = p_id;
    return jsonb_build_object('ok', true, 'status', 'declined');
  end if;
  select d.data into v_off from public.docs d where d.path = 'academy/data/players/' || v_row.offline_id;
  if v_off is null or v_off -> 'archived' = 'true'::jsonb or v_off ->> 'ownerId' is distinct from v_row.coach_id::text
     or not exists (select 1 from public.connections where coach_id = v_row.coach_id and family_id = v_uid and status = 'accepted') then
    update public.link_requests set status = 'cancelled', responded_at = now() where id = p_id;
    return jsonb_build_object('error', 'not_found');
  end if;
  v_n := public.do_merge_offline(v_row.offline_id, v_uid);
  update public.link_requests set status = 'accepted', responded_at = now() where id = p_id;
  return jsonb_build_object('ok', true, 'status', 'accepted', 'moved', v_n);
end $$;

create or replace function public.my_link_requests()
returns table (id uuid, offline_id text, offline_name text, coach_username text, coach_name text, family_username text, family_name text, direction text, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select l.id, l.offline_id, l.offline_name, pc.username, pc.display_name, pf.username, pf.display_name,
         case when l.coach_id = (select auth.uid()) then 'out' else 'in' end, l.created_at
  from public.link_requests l
  join public.profiles pc on pc.user_id = l.coach_id
  join public.profiles pf on pf.user_id = l.family_id
  where l.status = 'pending' and (l.coach_id = (select auth.uid()) or l.family_id = (select auth.uid()))
  order by l.created_at
$$;

-- Coaches now ask the family first (request_link); the direct move stays for the admin only.
create or replace function public.merge_offline_player(p_offline text, p_username text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_family uuid; v_off jsonb;
begin
  if not public.is_admin() then return jsonb_build_object('error', 'not_allowed'); end if;
  if public.is_account_id(p_offline) then return jsonb_build_object('error', 'not_offline'); end if;
  select d.data into v_off from public.docs d where d.path = 'academy/data/players/' || p_offline;
  if v_off is null or v_off -> 'archived' = 'true'::jsonb then return jsonb_build_object('error', 'not_found'); end if;
  select user_id into v_family from public.profiles where username = lower(btrim(coalesce(p_username, ''))) and kind = 'family';
  if v_family is null then return jsonb_build_object('error', 'not_found'); end if;
  return jsonb_build_object('ok', true, 'moved', public.do_merge_offline(p_offline, v_family));
end $$;

-- ---------- matches charted by a family ----------
create or replace function public.family_save_match(p_match jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_id text;
  v_old jsonb;
begin
  if v_uid is null then return jsonb_build_object('error', 'not_signed_in'); end if;
  if public.my_kind() is distinct from 'family' then return jsonb_build_object('error', 'not_family'); end if;
  if public.me_blocked() then return jsonb_build_object('error', 'blocked'); end if;
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
    values ('academy/data/matches/' || v_id, p_match || jsonb_build_object('scorerId', v_uid::text, 'scorerRole', 'parent',
            'ai', coalesce(v_old -> 'ai', 'null'::jsonb), 'createdBy', coalesce(v_old ->> 'createdBy', v_uid::text)))
    on conflict (path) do update set data = excluded.data;
  return jsonb_build_object('ok', true);
end $$;

-- A family removes a match they charted (it is hidden for everyone; the record stays).
create or replace function public.family_delete_match(p_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_n int;
begin
  if v_uid is null or public.my_kind() is distinct from 'family' then return jsonb_build_object('error', 'not_family'); end if;
  update public.docs set data = data || jsonb_build_object('deletedAt', now())
    where path = 'academy/data/matches/' || coalesce(p_id, '')
      and data ->> 'playerId' = v_uid::text
      and (data ->> 'createdBy' = v_uid::text or data ->> 'scorerId' = v_uid::text);
  get diagnostics v_n = row_count;
  return case when v_n = 0 then jsonb_build_object('error', 'not_found') else jsonb_build_object('ok', true) end;
end $$;

-- ---------- admin ----------
create or replace function public.admin_set_flags(p_username text, p_blocked boolean default null, p_verified boolean default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_target uuid;
begin
  if not public.is_admin() then return jsonb_build_object('error', 'not_admin'); end if;
  select user_id into v_target from public.profiles where username = lower(btrim(coalesce(p_username, '')));
  if v_target is null then return jsonb_build_object('error', 'not_found'); end if;
  if p_blocked is true and exists (select 1 from public.staff where user_id = v_target) then return jsonb_build_object('error', 'staff'); end if;
  update public.profiles set blocked = coalesce(p_blocked, blocked), verified = coalesce(p_verified, verified) where user_id = v_target;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_profiles_v2()
returns table (user_id uuid, username text, display_name text, kind text, email text, created_at timestamptz, connections int,
               blocked boolean, verified boolean, guardian boolean, consent_at timestamptz, staff boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then return; end if;
  return query
    select p.user_id, p.username, p.display_name, p.kind, u.email::text, p.created_at,
           (select count(*)::int from public.connections c where c.status = 'accepted' and (c.coach_id = p.user_id or c.family_id = p.user_id)),
           p.blocked, p.verified, p.guardian, p.consent_at, exists (select 1 from public.staff s where s.user_id = p.user_id)
    from public.profiles p join auth.users u on u.id = p.user_id
    order by p.kind, p.username;
end $$;

-- ---------- push notifications ----------
create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_lang text, p_user_agent text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid());
begin
  if v_uid is null or public.my_kind() is null then return jsonb_build_object('error', 'no_profile'); end if;
  -- Only the browsers' push services (Google, Mozilla, Apple, Microsoft): the server never posts anywhere else.
  if coalesce(p_endpoint, '') !~ '^https://(fcm\.googleapis\.com|android\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9-]+\.push\.apple\.com|[a-z0-9-]+\.notify\.windows\.com)/' or char_length(p_endpoint) > 2000
     or coalesce(p_p256dh, '') !~ '^[A-Za-z0-9_-]{80,100}$' or coalesce(p_auth, '') !~ '^[A-Za-z0-9_-]{16,30}$' then
    return jsonb_build_object('error', 'bad_subscription');
  end if;
  insert into public.push_subscriptions (endpoint, user_id, p256dh, auth, lang, user_agent, created_at, disabled_at)
    values (p_endpoint, v_uid, p_p256dh, p_auth, case when p_lang = 'fa' then 'fa' else 'en' end, left(p_user_agent, 300), now(), null)
    on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
      lang = excluded.lang, user_agent = excluded.user_agent, disabled_at = null;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.disable_push_subscription(p_endpoint text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  update public.push_subscriptions set disabled_at = now() where endpoint = p_endpoint and user_id = (select auth.uid());
  return jsonb_build_object('ok', true);
end $$;

-- ---------- grants ----------
revoke all on function
  public.me_blocked(), public.register_profile_v2(text, text, text, int, boolean, boolean, text), public.give_consent(boolean, text),
  public.update_my_profile(text, boolean, boolean), public.change_username(text), public.family_update_player(jsonb),
  public.search_people(text), public.my_connections_v2(), public.request_link(text, text), public.cancel_link(uuid),
  public.respond_link(uuid, boolean), public.my_link_requests(), public.family_delete_match(text),
  public.admin_set_flags(text, boolean, boolean), public.admin_profiles_v2(),
  public.save_push_subscription(text, text, text, text, text), public.disable_push_subscription(text)
  from public, anon;
grant execute on function
  public.me_blocked(), public.register_profile_v2(text, text, text, int, boolean, boolean, text), public.give_consent(boolean, text),
  public.update_my_profile(text, boolean, boolean), public.change_username(text), public.family_update_player(jsonb),
  public.search_people(text), public.my_connections_v2(), public.request_link(text, text), public.cancel_link(uuid),
  public.respond_link(uuid, boolean), public.my_link_requests(), public.family_delete_match(text),
  public.admin_set_flags(text, boolean, boolean), public.admin_profiles_v2(),
  public.save_push_subscription(text, text, text, text, text), public.disable_push_subscription(text)
  to authenticated;
revoke all on function public.keep_created_by() from public, anon, authenticated;
-- Sign-up without consent is closed; the app uses register_profile_v2.
revoke execute on function public.register_profile(text, text, text, int, text, text) from authenticated;
