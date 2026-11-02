-- 21GRAM Tennis — parents chart the live score of their own child's matches; coaches follow live.
-- Run once in Supabase → SQL Editor → New query → paste → Run (after academy.sql and invites.sql). Safe to run again.
--
-- A parent may only: write a match for a child they are linked to, and only a match they charted
-- themselves (scorerId = them). If a coach takes the scoring over, the parent can no longer write it.
-- Everything else stays read-only for parents (the docs table policies do not change).

create or replace function public.family_save_match(p_match jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_id text;
  v_player text;
  v_pdoc jsonb;
  v_old jsonb;
  v_new jsonb;
  v_parent text;
begin
  if v_uid is null then return jsonb_build_object('error', 'not_signed_in'); end if;
  if (select public.my_role()) is not null then return jsonb_build_object('error', 'staff_account'); end if;
  if p_match is null or jsonb_typeof(p_match) <> 'object' then return jsonb_build_object('error', 'bad_match'); end if;
  v_id := p_match ->> 'id';
  v_player := p_match ->> 'playerId';
  if v_id is null or v_id !~ '^[A-Za-z0-9_.~:@+-]{1,100}$' or v_player is null or v_player !~ '^[A-Za-z0-9_.~:@+-]{1,100}$' then
    return jsonb_build_object('error', 'bad_match');
  end if;
  if jsonb_typeof(coalesce(p_match -> 'points', '[]'::jsonb)) <> 'array' or pg_column_size(p_match) > 300000
     or jsonb_array_length(coalesce(p_match -> 'points', '[]'::jsonb)) > 3000 then
    return jsonb_build_object('error', 'too_big');
  end if;
  select d.data into v_pdoc from public.docs d where d.path = 'academy/data/players/' || v_player;
  if v_pdoc is null or not (coalesce(v_pdoc -> 'parentIds', '[]'::jsonb) ? v_uid::text) then
    return jsonb_build_object('error', 'not_linked');
  end if;
  select d.data into v_old from public.docs d where d.path = 'academy/data/matches/' || v_id;
  if v_old is not null and (v_old ->> 'playerId' is distinct from v_player or coalesce(v_old ->> 'scorerId', '') <> v_uid::text) then
    return jsonb_build_object('error', 'not_scorer');
  end if;
  -- The parent is the scorer; a coach's AI analysis on this match is kept as it was.
  v_new := p_match || jsonb_build_object('scorerId', v_uid::text, 'scorerRole', 'parent', 'ai', coalesce(v_old -> 'ai', 'null'::jsonb));
  insert into public.docs (path, data) values ('academy/data/matches/' || v_id, v_new)
    on conflict (path) do update set data = excluded.data;
  -- Every family linked to this child sees it at once (coaches' apps keep these copies up to date too).
  for v_parent in select jsonb_array_elements_text(coalesce(v_pdoc -> 'parentIds', '[]'::jsonb)) loop
    update public.docs d set data = jsonb_set(d.data, '{matches}', coalesce((
        select jsonb_agg(x.m order by x.m ->> 'date', x.m ->> 'createdAt') from (
          select m from jsonb_array_elements(coalesce(d.data -> 'matches', '[]'::jsonb)) m where m ->> 'id' is distinct from v_id
          union all
          select v_new) x), '[]'::jsonb))
      where d.path = 'family/' || v_parent || '/players/' || v_player;
    if not found then
      insert into public.docs (path, data) values ('family/' || v_parent || '/players/' || v_player, public.family_copy(v_player))
        on conflict (path) do nothing;
    end if;
  end loop;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.family_save_match(jsonb) from public, anon, authenticated;
grant execute on function public.family_save_match(jsonb) to authenticated;
