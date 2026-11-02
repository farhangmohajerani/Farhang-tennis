-- 21GRAM Tennis — plans (subscriptions) and account deletion.
-- Run once in Supabase → SQL Editor → New query → Run (after academy.sql).

-- A person's plan. The admin gives Family plans by hand ('manual'); purchases in the
-- App Store / Google Play will be written by a server function with the service role.
create table if not exists public.subscriptions (
  user_id uuid primary key references auth.users (id) on delete cascade,
  plan text not null check (plan in ('coach', 'family')),
  expires_at timestamptz,
  source text not null default 'manual' check (source in ('manual', 'apple', 'google', 'web')),
  updated_at timestamptz not null default now()
);
alter table public.subscriptions enable row level security;
-- Created only when missing, so running this file again changes nothing.
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'subscriptions' and policyname = 'subs_read') then
    create policy subs_read on public.subscriptions for select to authenticated
      using (user_id = (select auth.uid()) or (select public.my_role()) = 'admin');
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'subscriptions' and policyname = 'subs_admin_insert') then
    create policy subs_admin_insert on public.subscriptions for insert to authenticated
      with check ((select public.my_role()) = 'admin' and source = 'manual');
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'subscriptions' and policyname = 'subs_admin_update') then
    create policy subs_admin_update on public.subscriptions for update to authenticated
      using ((select public.my_role()) = 'admin' and source = 'manual')
      with check ((select public.my_role()) = 'admin' and source = 'manual');
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'subscriptions' and policyname = 'subs_admin_delete') then
    create policy subs_admin_delete on public.subscriptions for delete to authenticated
      using ((select public.my_role()) = 'admin' and source = 'manual');
  end if;
end $$;

-- Delete the signed-in account (App Store rule 5.1.1(v)). Removes the person's family copies and
-- their link to players; the academy keeps its own training records. The last admin cannot leave.
create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  if exists (select 1 from public.staff where user_id = v_uid and role = 'admin')
     and (select count(*) from public.staff where role = 'admin') <= 1 then
    raise exception 'last_admin';
  end if;
  delete from public.docs where path like 'family/' || v_uid::text || '/%';
  update public.docs
     set data = jsonb_set(data, '{parentIds}', coalesce(
           (select jsonb_agg(x) from jsonb_array_elements(data -> 'parentIds') x where x <> to_jsonb(v_uid::text)),
           '[]'::jsonb))
   where path like 'academy/data/players/%' and data -> 'parentIds' ? v_uid::text;
  -- staff, staff_requests, pair_codes and subscriptions go with the user (on delete cascade).
  delete from auth.users where id = v_uid;
end $$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
