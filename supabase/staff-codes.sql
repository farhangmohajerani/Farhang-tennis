-- 21GRAM Tennis — coaches join with a code from the admin; database tidy-ups.
-- Run once in Supabase → SQL Editor → New query → paste → Run (after the other files). Safe to run again.
--
-- Why: sign-up emails are not verified (accounts are confirmed automatically so parents can start at
-- once), so an email address alone must never grant staff access. An invite now carries a 6-digit code
-- that the admin gives the coach; the coach signs up with the invited email and types the code. Coaches
-- without a code still ask for access and the admin approves them. Only a brand-new academy's first
-- admin (seeded in academy.sql) claims by email, while no admin exists yet.

-- A 6-digit code from Postgres' strong random source (gen_random_uuid).
create or replace function public.random_code() returns text
language sql volatile set search_path = '' as $$
  with b as (select uuid_send(gen_random_uuid()) as v)
  select ((get_byte(v, 0)::bigint * 16777216 + get_byte(v, 1) * 65536 + get_byte(v, 2) * 256 + get_byte(v, 3)) % 900000 + 100000)::text from b
$$;

alter table public.staff_invites add column if not exists code text not null default public.random_code();
alter table public.staff_invites add column if not exists used_at timestamptz;
create unique index if not exists staff_invites_code_key on public.staff_invites (code);

-- Admin: invite (or invite again) by email; returns the code to give the coach. A new invite replaces the old code.
create or replace function public.staff_invite(p_email text, p_role text default 'coach') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_email text := lower(btrim(coalesce(p_email, ''))); v_code text;
begin
  if (select public.my_role()) is distinct from 'admin' then raise exception 'not_admin'; end if;
  if p_role not in ('admin', 'coach') or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then raise exception 'bad_invite'; end if;
  loop
    v_code := public.random_code();
    begin
      insert into public.staff_invites as i (email, role, code, used_at, created_at) values (v_email, p_role, v_code, null, now())
        on conflict (email) do update set role = excluded.role, code = excluded.code, used_at = null, created_at = now();
      return jsonb_build_object('email', v_email, 'role', p_role, 'code', v_code);
    exception when unique_violation then
      -- that code is in use by another invite: draw again
    end;
  end loop;
end $$;

-- On every sign-in: the role this account has. Grants nothing from an email, except a new academy's first admin.
create or replace function public.claim_staff() returns text
language plpgsql security definer set search_path = '' as $$
declare v_email text := lower(coalesce((select auth.jwt()) ->> 'email', ''));
        v_role text;
begin
  if (select auth.uid()) is null then return null; end if;
  if not exists (select 1 from public.staff where role = 'admin') then
    select i.role into v_role from public.staff_invites i where i.email = v_email and i.role = 'admin' and i.used_at is null;
    if v_role is not null then
      insert into public.staff (user_id, email, role) values ((select auth.uid()), v_email, 'admin')
        on conflict (user_id) do update set role = excluded.role, email = excluded.email;
      update public.staff_invites set used_at = now() where email = v_email;
    end if;
  end if;
  return (select s.role from public.staff s where s.user_id = (select auth.uid()));
end $$;

-- A coach types the code from their invite: the email they signed up with must be the invited one.
-- Returns {role} or {error}; wrong codes are counted (10 per hour), so errors are returned, not raised.
create or replace function public.claim_staff_code(p_code text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid());
        v_email text := lower(coalesce((select auth.jwt()) ->> 'email', ''));
        v_role text;
begin
  if v_uid is null then return jsonb_build_object('error', 'not_signed_in'); end if;
  v_role := (select public.my_role());
  if v_role is not null then return jsonb_build_object('role', v_role); end if;
  if (select count(*) from public.invite_attempts a where a.user_id = v_uid and a.at > now() - interval '1 hour') >= 10 then
    return jsonb_build_object('error', 'too_many_attempts');
  end if;
  select i.role into v_role from public.staff_invites i
    where i.email = v_email and i.code = btrim(coalesce(p_code, '')) and i.used_at is null and i.created_at > now() - interval '30 days';
  if v_role is null then
    insert into public.invite_attempts (user_id) values (v_uid);
    return jsonb_build_object('error', 'invalid_code');
  end if;
  insert into public.staff (user_id, email, role) values (v_uid, v_email, v_role)
    on conflict (user_id) do update set role = excluded.role, email = excluded.email;
  update public.staff_invites set used_at = now() where email = v_email;
  return jsonb_build_object('role', v_role);
end $$;

-- From coach-requests.sql, in case it is missing.
create or replace function public.my_request_pending() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.staff_requests where user_id = (select auth.uid()))
$$;

revoke all on function public.staff_invite(text, text), public.claim_staff_code(text), public.my_request_pending() from public, anon;
grant execute on function public.staff_invite(text, text), public.claim_staff_code(text), public.my_request_pending() to authenticated;

-- Tidy-ups from the database advisor.
create index if not exists player_invites_created_by_idx on public.player_invites (created_by);
alter table public.invite_attempts add column if not exists id bigint generated always as identity primary key;
-- These tables are reached only through the functions above; say so explicitly (nothing is readable or writable directly).
do $$
declare t text;
begin
  foreach t in array array['pair_codes', 'player_invites', 'invite_attempts'] loop
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = 'no_direct_access') then
      execute format('create policy no_direct_access on public.%I for all to authenticated using (false) with check (false)', t);
    end if;
  end loop;
end $$;
