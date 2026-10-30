-- Tennis Progress — coach sign-up requests (run once in Supabase → SQL Editor → New query → Run).
-- Coaches who create their own account ask for access; an admin approves them in the app.
create table if not exists public.staff_requests (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  created_at timestamptz not null default now()
);
alter table public.staff_requests enable row level security;
drop policy if exists requests_admin_read on public.staff_requests;
drop policy if exists requests_admin_delete on public.staff_requests;
create policy requests_admin_read on public.staff_requests for select to authenticated using ((select public.my_role()) = 'admin');
create policy requests_admin_delete on public.staff_requests for delete to authenticated using ((select public.my_role()) = 'admin');

create or replace function public.request_coach() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null or (select public.my_role()) is not null then return; end if;
  insert into public.staff_requests (user_id, email)
    values ((select auth.uid()), lower(coalesce((select auth.jwt()) ->> 'email', '')))
    on conflict (user_id) do nothing;
end $$;

create or replace function public.approve_coach(p_user uuid, p_role text default 'coach') returns void
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce((select public.my_role()), '') <> 'admin' or p_role not in ('admin', 'coach') then
    raise exception 'Only admins can approve coaches';
  end if;
  insert into public.staff (user_id, email, role)
    select user_id, email, p_role from public.staff_requests where user_id = p_user
    on conflict (user_id) do update set role = excluded.role;
  delete from public.staff_requests where user_id = p_user;
end $$;

create or replace function public.my_request_pending() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.staff_requests where user_id = (select auth.uid()))
$$;

revoke all on function public.request_coach(), public.approve_coach(uuid, text), public.my_request_pending() from public, anon;
grant execute on function public.request_coach(), public.approve_coach(uuid, text), public.my_request_pending() to authenticated;
