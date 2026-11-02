\set QUIET on
\set VERBOSITY terse
delete from public.qa_results;
-- state after social-test: alya (family, connected to hamed) has log-k (moved), hamed owns archived player-kid; yaman has player, plan, matches
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333"}', false) \g /dev/null
select public.delete_my_account();
reset role;
select public.qa('family deleted: account, profile and connections gone', not exists (select 1 from auth.users where id = '33333333-3333-3333-3333-333333333333') and not exists (select 1 from public.profiles where username = 'yaman') and not exists (select 1 from public.connections where family_id = '33333333-3333-3333-3333-333333333333'));
select public.qa('family deleted: their player, plan and matches gone', not exists (select 1 from public.docs where path like '%33333333-3333-3333-3333-333333333333' or data ->> 'playerId' = '33333333-3333-3333-3333-333333333333'));
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111"}', false) \g /dev/null
select public.delete_my_account();
reset role;
select public.qa('coach deleted: account and profile gone', not exists (select 1 from auth.users where id = '11111111-1111-1111-1111-111111111111') and not exists (select 1 from public.profiles where username = 'hamed'));
select public.qa('coach deleted: his own (archived) player gone', not exists (select 1 from public.docs where path = 'academy/data/players/player-kid'));
select public.qa('coach deleted: the connected family keeps its data (alya''s player and result)', exists (select 1 from public.docs where path = 'academy/data/players/44444444-4444-4444-4444-444444444444') and exists (select 1 from public.docs where path = 'academy/data/logs/log-k'));
select public.qa('the admin''s older player is untouched', exists (select 1 from public.docs where path = 'academy/data/players/player-old'));
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a"}', false) \g /dev/null
do $$ begin perform public.delete_my_account(); perform public.qa('the last admin cannot delete the account', false);
exception when others then perform public.qa('the last admin cannot delete the account', sqlerrm = 'last_admin'); end $$;
reset role;
\pset tuples_only on
\pset format unaligned
select (case when ok is true then 'PASS  ' else 'FAIL  ' end) || label from public.qa_results order by n;
select '---- ' || count(*) filter (where ok is true) || ' passed, ' || count(*) filter (where ok is not true) || ' failed' from public.qa_results;
