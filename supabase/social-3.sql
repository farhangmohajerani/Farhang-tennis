-- 21GRAM Tennis — names instead of usernames, three kinds of account, and a profile filled in later.
-- Run after supabase/social-2.sql (SQL Editor → New query → paste → Run). Safe to run again; nothing here
-- removes data.
--
--  * Sign-up asks only first name, last name, email and password (the email and password belong to
--    Supabase Auth); everything else is answered later in the profile.
--  * People find each other by first and last name. Usernames stay as hidden internal ids.
--  * Three kinds of account: coach, family (a parent, for one player) and player (the player themself).
--    Families and players are both kind 'family' with one player each; holder says who holds the account.
--  * Birth year, level, playing hand and backhand stay empty until the person answers them.

-- ---------- columns ----------
alter table public.profiles add column if not exists first_name text;
alter table public.profiles add column if not exists last_name text;
alter table public.profiles add column if not exists holder text;
alter table public.profiles add column if not exists details jsonb not null default '{}'::jsonb;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_holder_check') then
    alter table public.profiles add constraint profiles_holder_check check (holder in ('parent', 'player'));
  end if;
end $$;

-- Accounts from before: first and last name from the display name; families are held by a parent.
update public.profiles set
  first_name = coalesce(first_name, split_part(btrim(display_name), ' ', 1)),
  last_name = coalesce(last_name, nullif(btrim(substr(btrim(display_name), char_length(split_part(btrim(display_name), ' ', 1)) + 1)), ''))
where first_name is null;
update public.profiles set holder = 'parent' where kind = 'family' and holder is null;
-- Finding each other by name is now how people connect: everyone is findable once (families can turn it
-- off in Settings afterwards; running this file again does not undo their choice).
do $$
begin
  if not exists (select 1 from public.app_keys where name = 'migrated_social_3') then
    update public.profiles set discoverable = true where not discoverable;
    insert into public.app_keys (name, value) values ('migrated_social_3', now()::text);
  end if;
end $$;

-- ---------- helpers ----------
-- Names compared the way people type them: lower case, Arabic and Persian forms of ی ک ه alike, no ZWNJ.
create or replace function public.norm_name(p text) returns text
language sql immutable set search_path = '' as $$
  select btrim(regexp_replace(translate(lower(coalesce(p, '')), 'يكۀة' || chr(8204), 'یکهه'), '\s+', ' ', 'g'))
$$;

-- A hidden, unique internal id for a new profile (people never see or type it).
create or replace function public.new_username() returns text
language plpgsql volatile security definer set search_path = '' as $$
declare v text;
begin
  loop
    v := 'u' || substr(md5(gen_random_uuid()::text), 1, 11);
    exit when not exists (select 1 from public.profiles where username = v);
  end loop;
  return v;
end $$;

-- Optional profile answers, cleaned: known keys only, short text, allowed choices.
create or replace function public.clean_details(p_kind text, p_holder text, p_old jsonb, p_new jsonb) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare
  v jsonb := coalesce(p_old, '{}'::jsonb);
  k text;
  val text;
  allowed text[] := case
    when p_kind = 'coach' then array['club', 'city', 'yearsCoaching', 'certifications', 'bio']
    when p_holder = 'parent' then array['parentName', 'city']
    else array['city'] end;
  limits jsonb := '{"club":80,"city":60,"certifications":120,"bio":300,"parentName":80}';
begin
  if p_new is null or jsonb_typeof(p_new) <> 'object' then return v; end if;
  for k in select jsonb_object_keys(p_new) loop
    continue when not (k = any (allowed));
    val := btrim(coalesce(p_new ->> k, ''));
    if val = '' then
      v := v - k;
    elsif k = 'yearsCoaching' then
      if val in ('0-2', '3-5', '6-10', '10+') then v := v || jsonb_build_object(k, val); end if;
    else
      v := v || jsonb_build_object(k, left(val, (limits ->> k)::int));
    end if;
  end loop;
  return v;
end $$;

-- ---------- sign-up: names only ----------
create or replace function public.register_profile_v3(p_first text, p_last text, p_kind text, p_consent text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_first text := btrim(regexp_replace(coalesce(p_first, ''), '\s+', ' ', 'g'));
  v_last text := btrim(regexp_replace(coalesce(p_last, ''), '\s+', ' ', 'g'));
  v_kind text;
  v_username text;
begin
  if v_uid is null then return jsonb_build_object('error', 'not_signed_in'); end if;
  if exists (select 1 from public.profiles where user_id = v_uid) then return jsonb_build_object('error', 'exists'); end if;
  if char_length(v_first) not between 1 and 40 or char_length(v_last) not between 1 and 40 then return jsonb_build_object('error', 'bad_name'); end if;
  if p_kind is null or p_kind not in ('coach', 'family', 'player') then return jsonb_build_object('error', 'bad_kind'); end if;
  if char_length(btrim(coalesce(p_consent, ''))) not between 1 and 40 then return jsonb_build_object('error', 'consent_required'); end if;
  v_kind := case when p_kind = 'coach' then 'coach' else 'family' end;
  v_username := public.new_username();
  insert into public.profiles (user_id, username, display_name, kind, first_name, last_name, holder, discoverable, guardian, consent_version, consent_at)
    values (v_uid, v_username, v_first || ' ' || v_last, v_kind, v_first, v_last,
            case p_kind when 'family' then 'parent' when 'player' then 'player' end,
            true, p_kind = 'family', btrim(p_consent), now());
  if v_kind = 'family' then
    -- Nothing is assumed: birth year, level, hand and backhand wait for the profile.
    insert into public.docs (path, data) values ('academy/data/players/' || v_uid::text, jsonb_build_object(
      'id', v_uid::text, 'name', v_first || ' ' || v_last,
      'birthYear', null, 'level', null, 'hand', null, 'backhand', null,
      'coachId', '', 'parentId', '', 'parentIds', '[]'::jsonb, 'goals', '',
      'accountId', v_uid::text, 'username', v_username, 'aiConsent', false))
    on conflict (path) do nothing;
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- Accounts made before consent was asked accept it once; a player who holds their own account is not
-- asked the parent-or-guardian line.
create or replace function public.give_consent(p_guardian boolean, p_consent text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_kind text := public.my_kind();
  v_parent boolean;
begin
  if v_uid is null or v_kind is null then return jsonb_build_object('error', 'no_profile'); end if;
  if char_length(btrim(coalesce(p_consent, ''))) not between 1 and 40 then return jsonb_build_object('error', 'consent_required'); end if;
  select v_kind = 'family' and coalesce(holder, 'parent') = 'parent' into v_parent from public.profiles where user_id = v_uid;
  if v_parent and p_guardian is not true then return jsonb_build_object('error', 'guardian_required'); end if;
  update public.profiles set consent_version = btrim(p_consent), consent_at = now(), guardian = v_parent
    where user_id = v_uid;
  return jsonb_build_object('ok', true);
end $$;

-- ---------- my profile ----------
create or replace function public.my_profile() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('username', p.username, 'displayName', p.display_name, 'kind', p.kind,
    'firstName', coalesce(p.first_name, p.display_name), 'lastName', coalesce(p.last_name, ''), 'holder', p.holder,
    'details', p.details,
    'discoverable', p.discoverable, 'notifyLive', p.notify_live, 'verified', p.verified, 'blocked', p.blocked,
    'guardian', p.guardian, 'consentAt', p.consent_at)
  from public.profiles p where p.user_id = (select auth.uid())
$$;

-- Names, the optional answers, being found by name (families and players) and match notifications.
create or replace function public.update_my_profile_v2(
  p_first text default null, p_last text default null, p_details jsonb default null,
  p_discoverable boolean default null, p_notify_live boolean default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_me public.profiles;
  v_first text := btrim(regexp_replace(coalesce(p_first, ''), '\s+', ' ', 'g'));
  v_last text := btrim(regexp_replace(coalesce(p_last, ''), '\s+', ' ', 'g'));
  v_name text;
begin
  select * into v_me from public.profiles where user_id = v_uid;
  if v_uid is null or v_me.user_id is null then return jsonb_build_object('error', 'no_profile'); end if;
  if (p_first is not null and char_length(v_first) not between 1 and 40) or (p_last is not null and char_length(v_last) not between 1 and 40) then
    return jsonb_build_object('error', 'bad_name');
  end if;
  if p_first is not null or p_last is not null then
    v_name := coalesce(nullif(v_first, ''), v_me.first_name, '') || ' ' || coalesce(nullif(v_last, ''), v_me.last_name, '');
    v_name := btrim(v_name);
  end if;
  update public.profiles set
    first_name = case when p_first is null then first_name else v_first end,
    last_name = case when p_last is null then last_name else v_last end,
    display_name = coalesce(v_name, display_name),
    details = case when p_details is null then details else public.clean_details(kind, holder, details, p_details) end,
    discoverable = case when kind = 'coach' then true when p_discoverable is null then discoverable else p_discoverable end,
    notify_live = coalesce(p_notify_live, notify_live)
  where user_id = v_uid;
  if v_me.kind = 'family' and v_name is not null then
    update public.docs set data = data || jsonb_build_object('name', v_name) where path = 'academy/data/players/' || v_uid::text;
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- A family or player answers the player's questions (coaches can adjust level and goals later).
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
    if char_length(v_name) not between 1 and 81 then return jsonb_build_object('error', 'bad_name'); end if;
    v_clean := v_clean || jsonb_build_object('name', v_name);
  end if;
  if p_patch ? 'birthYear' then
    if jsonb_typeof(p_patch -> 'birthYear') <> 'number' or (p_patch ->> 'birthYear')::numeric not between v_year - 90 and v_year - 3 then
      return jsonb_build_object('error', 'bad_year');
    end if;
    v_clean := v_clean || jsonb_build_object('birthYear', (p_patch ->> 'birthYear')::int);
  end if;
  if p_patch ? 'level' then
    if p_patch ->> 'level' not in ('beginner', 'intermediate', 'advanced', 'professional') then return jsonb_build_object('error', 'bad_level'); end if;
    v_clean := v_clean || jsonb_build_object('level', p_patch ->> 'level');
  end if;
  if p_patch ? 'hand' then
    if p_patch ->> 'hand' not in ('right', 'left') then return jsonb_build_object('error', 'bad_hand'); end if;
    v_clean := v_clean || jsonb_build_object('hand', p_patch ->> 'hand');
  end if;
  if p_patch ? 'backhand' then
    if p_patch ->> 'backhand' not in ('one', 'two') then return jsonb_build_object('error', 'bad_backhand'); end if;
    v_clean := v_clean || jsonb_build_object('backhand', p_patch ->> 'backhand');
  end if;
  if p_patch ? 'yearsPlaying' then
    if p_patch ->> 'yearsPlaying' not in ('<1', '1-3', '3-5', '5+') then return jsonb_build_object('error', 'bad_years'); end if;
    v_clean := v_clean || jsonb_build_object('yearsPlaying', p_patch ->> 'yearsPlaying');
  end if;
  if p_patch ? 'goals' then
    v_clean := v_clean || jsonb_build_object('goals', left(btrim(coalesce(p_patch ->> 'goals', '')), 500));
  end if;
  if p_patch ? 'aiConsent' then
    if jsonb_typeof(p_patch -> 'aiConsent') <> 'boolean' then return jsonb_build_object('error', 'bad_consent'); end if;
    v_clean := v_clean || jsonb_build_object('aiConsent', p_patch -> 'aiConsent');
  end if;
  update public.docs set data = data || v_clean where path = 'academy/data/players/' || v_uid::text;
  if v_name is not null then update public.profiles set display_name = v_name where user_id = v_uid; end if;
  return jsonb_build_object('ok', true);
end $$;

-- ---------- finding each other by name ----------
-- Coaches by first or last name; families and players too unless they turned it off. Blocked accounts are
-- never listed. A coach's club and city help tell two people with the same name apart.
create or replace function public.search_people_v2(p_query text)
returns table (username text, display_name text, kind text, holder text, verified boolean, club text, city text, status text, direction text)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_kind text := public.my_kind();
  v_q text := public.norm_name(p_query);
  v_like text;
begin
  v_q := btrim(regexp_replace(v_q, '[^[:alnum:]_. ''-]', '', 'g'));
  if v_uid is null or v_kind is null or char_length(v_q) < 2 or public.me_blocked() then return; end if;
  v_like := replace(v_q, '_', '\_');
  return query
    select p.username, p.display_name, p.kind, p.holder, p.verified,
           case when p.kind = 'coach' then p.details ->> 'club' end, case when p.kind = 'coach' then p.details ->> 'city' end,
           case when c.status in ('pending', 'accepted') then c.status end,
           case when c.status in ('pending', 'accepted') then (case when c.requested_by = v_kind then 'out' else 'in' end) end
    from public.profiles p
    left join public.connections c
      on (v_kind = 'coach' and c.coach_id = v_uid and c.family_id = p.user_id)
      or (v_kind = 'family' and c.family_id = v_uid and c.coach_id = p.user_id)
    where p.kind <> v_kind and p.user_id <> v_uid and not p.blocked and (p.kind = 'coach' or p.discoverable)
      and (public.norm_name(p.first_name) like v_like || '%'
           or public.norm_name(p.last_name) like v_like || '%'
           or public.norm_name(p.display_name) like v_like || '%'
           or public.norm_name(p.display_name) like '% ' || v_like || '%')
    order by p.verified desc, public.norm_name(p.display_name), p.username
    limit 20;
end $$;

create or replace function public.my_connections_v3()
returns table (username text, display_name text, kind text, holder text, verified boolean, club text, city text, status text, direction text, player_id text, since timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_kind text := public.my_kind();
begin
  if v_uid is null or v_kind is null then return; end if;
  return query
    select p.username, p.display_name, p.kind, p.holder, p.verified,
           case when p.kind = 'coach' then p.details ->> 'club' end, case when p.kind = 'coach' then p.details ->> 'city' end,
           c.status, case when c.requested_by = v_kind then 'out' else 'in' end,
           c.family_id::text, coalesce(c.responded_at, c.created_at)
    from public.connections c
    join public.profiles p on p.user_id = case when v_kind = 'coach' then c.family_id else c.coach_id end
    where c.status in ('pending', 'accepted')
      and ((v_kind = 'coach' and c.coach_id = v_uid) or (v_kind = 'family' and c.family_id = v_uid))
    order by c.status desc, public.norm_name(p.display_name);
end $$;

-- ---------- admin ----------
create or replace function public.admin_profiles_v3()
returns table (user_id uuid, username text, display_name text, kind text, holder text, email text, created_at timestamptz, connections int,
               blocked boolean, verified boolean, guardian boolean, consent_at timestamptz, staff boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then return; end if;
  return query
    select p.user_id, p.username, p.display_name, p.kind, p.holder, u.email::text, p.created_at,
           (select count(*)::int from public.connections c where c.status = 'accepted' and (c.coach_id = p.user_id or c.family_id = p.user_id)),
           p.blocked, p.verified, p.guardian, p.consent_at, exists (select 1 from public.staff s where s.user_id = p.user_id)
    from public.profiles p join auth.users u on u.id = p.user_id
    order by p.kind, public.norm_name(p.display_name);
end $$;

-- ---------- grants ----------
revoke all on function public.new_username(), public.clean_details(text, text, jsonb, jsonb) from public, anon, authenticated;
revoke all on function
  public.register_profile_v3(text, text, text, text), public.update_my_profile_v2(text, text, jsonb, boolean, boolean),
  public.search_people_v2(text), public.my_connections_v3(), public.admin_profiles_v3()
  from public, anon;
grant execute on function
  public.register_profile_v3(text, text, text, text), public.update_my_profile_v2(text, text, jsonb, boolean, boolean),
  public.search_people_v2(text), public.my_connections_v3(), public.admin_profiles_v3()
  to authenticated;
-- Sign-up with a username and a default playing hand is closed; the app uses register_profile_v3.
revoke execute on function public.register_profile_v2(text, text, text, int, boolean, boolean, text) from authenticated;
