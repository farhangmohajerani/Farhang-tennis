-- Tennis Progress — run once in Supabase → SQL Editor → New query → paste → Run.
create table public.staff (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  role text not null check (role in ('admin', 'coach')),
  created_at timestamptz not null default now()
);
create table public.staff_invites (
  email text primary key check (email = lower(email)),
  role text not null check (role in ('admin', 'coach')),
  created_at timestamptz not null default now()
);
create table public.docs (
  path text primary key check (path ~ '^[A-Za-z0-9_.~:@+-]+(/[A-Za-z0-9_.~:@+-]+)+$'),
  parent text generated always as (regexp_replace(path, '/[^/]+$', '')) stored,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
create index docs_parent_idx on public.docs (parent);
create index docs_updated_idx on public.docs (updated_at);
create table public.pair_codes (
  user_id uuid primary key references auth.users (id) on delete cascade,
  code text not null unique,
  created_at timestamptz not null default now()
);
alter table public.staff enable row level security;
alter table public.staff_invites enable row level security;
alter table public.docs enable row level security;
alter table public.pair_codes enable row level security;

create or replace function public.my_role() returns text
language sql stable security definer set search_path = '' as $$
  select role from public.staff where user_id = (select auth.uid())
$$;

create policy docs_read on public.docs for select to authenticated using (
  (select public.my_role()) is not null
  or path like 'family/' || (select auth.uid())::text || '/%'
);
create policy docs_insert on public.docs for insert to authenticated with check (
  (select public.my_role()) = 'admin'
  or ((select public.my_role()) = 'coach' and path not like 'academy/library/%' and path <> 'academy/config')
);
create policy docs_update on public.docs for update to authenticated using (
  (select public.my_role()) = 'admin'
  or ((select public.my_role()) = 'coach' and path not like 'academy/library/%' and path <> 'academy/config')
) with check (
  (select public.my_role()) = 'admin'
  or ((select public.my_role()) = 'coach' and path not like 'academy/library/%' and path <> 'academy/config')
);
create policy docs_delete on public.docs for delete to authenticated using (
  (select public.my_role()) = 'admin'
  or ((select public.my_role()) = 'coach' and path not like 'academy/library/%' and path <> 'academy/config')
);

create or replace function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;
create trigger docs_touch before update on public.docs for each row execute function public.touch_updated_at();

create policy staff_read on public.staff for select to authenticated using ((select public.my_role()) is not null);
create policy staff_admin_write on public.staff for all to authenticated
  using ((select public.my_role()) = 'admin') with check ((select public.my_role()) = 'admin');
create policy invites_admin on public.staff_invites for all to authenticated
  using ((select public.my_role()) = 'admin') with check ((select public.my_role()) = 'admin');

create or replace function public.claim_staff() returns text
language plpgsql security definer set search_path = '' as $$
declare v_email text := lower(coalesce((select auth.jwt()) ->> 'email', ''));
        v_role text;
begin
  if (select auth.uid()) is null then return null; end if;
  select role into v_role from public.staff_invites where email = v_email;
  if v_role is not null then
    insert into public.staff (user_id, email, role) values ((select auth.uid()), v_email, v_role)
      on conflict (user_id) do update set role = excluded.role, email = excluded.email;
    delete from public.staff_invites where email = v_email;
  end if;
  return (select role from public.staff where user_id = (select auth.uid()));
end $$;

create or replace function public.my_pair_code() returns text
language plpgsql security definer set search_path = '' as $$
declare v_code text;
begin
  if (select auth.uid()) is null then return null; end if;
  select code into v_code from public.pair_codes
    where user_id = (select auth.uid()) and created_at > now() - interval '7 days';
  if v_code is not null then return v_code; end if;
  loop
    v_code := lpad((floor(random() * 900000) + 100000)::int::text, 6, '0');
    begin
      insert into public.pair_codes (user_id, code) values ((select auth.uid()), v_code)
        on conflict (user_id) do update set code = excluded.code, created_at = now();
      return v_code;
    exception when unique_violation then
    end;
  end loop;
end $$;

create or replace function public.resolve_pair_code(p_code text) returns uuid
language plpgsql security definer set search_path = '' as $$
begin
  if (select public.my_role()) is null then return null; end if;
  return (select user_id from public.pair_codes
          where code = p_code and created_at > now() - interval '7 days');
end $$;

create or replace function public.user_emails(p_ids uuid[]) returns table (id uuid, email text)
language plpgsql security definer set search_path = '' as $$
begin
  if (select public.my_role()) is null then return; end if;
  return query select u.id, u.email::text from auth.users u where u.id = any (p_ids);
end $$;

revoke all on function public.claim_staff(), public.my_pair_code(), public.resolve_pair_code(text), public.user_emails(uuid[]), public.my_role() from public, anon;
grant execute on function public.claim_staff(), public.my_pair_code(), public.resolve_pair_code(text), public.user_emails(uuid[]), public.my_role() to authenticated;

insert into public.staff_invites (email, role) values ('farhangmohajerani87@gmail.com', 'admin');
