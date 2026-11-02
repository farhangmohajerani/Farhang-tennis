\set QUIET on
\set VERBOSITY terse
create table public.qa_results (n serial, label text, ok boolean);
grant insert, select on public.qa_results to anon, authenticated;
grant usage on sequence public.qa_results_n_seq to anon, authenticated;
create function public.qa(label text, ok boolean) returns void language sql as $$ insert into public.qa_results (label, ok) values (label, ok) $$;
grant execute on function public.qa(text, boolean) to anon, authenticated;
-- accounts: admin, coach hamed, coach reza (stranger coach), families yaman and alya
insert into auth.users (id, email) values
 ('00000000-0000-0000-0000-00000000000a', 'owner@example.com'),
 ('11111111-1111-1111-1111-111111111111', 'hamed@example.com'),
 ('22222222-2222-2222-2222-222222222222', 'reza@example.com'),
 ('33333333-3333-3333-3333-333333333333', 'yaman@example.com'),
 ('44444444-4444-4444-4444-444444444444', 'alya@example.com');
-- the owner's admin invite (academy.sql has the real owner's)
insert into public.staff_invites (email, role) values ('owner@example.com', 'admin');
-- an older player the admin made before (no owner)
insert into public.docs (path, data) values ('academy/data/players/player-old', '{"id":"player-old","name":"Old Player","birthYear":2013,"level":"intermediate","hand":"right","backhand":"two","coachId":"","parentId":"","parentIds":[],"goals":""}'),
  ('academy/data/matches/m-old', '{"id":"m-old","playerId":"player-old","date":"2026-10-01"}'),
  ('academy/library/drills/d1', '{"id":"d1","access":"pro"}'), ('academy/config', '{"paywall":true}');

set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","email":"owner@example.com"}', false) \g /dev/null
select public.qa('admin: first admin', public.claim_staff() = 'admin');
select public.qa('admin: registers a coach profile', (public.register_profile('farhang', 'Farhang', 'coach') ->> 'ok') = 'true');

select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111"}', false) \g /dev/null
select public.qa('hamed: no profile yet', public.my_profile() is null);
select public.qa('hamed: username check', public.username_available('Hamed') and not public.username_available('ab') and not public.username_available('farhang'));
select public.qa('hamed: registers as coach', (public.register_profile(' Hamed ', 'Hamed K.', 'coach') ->> 'username') = 'hamed');
select public.qa('hamed: cannot register twice', (public.register_profile('hamed2', 'H', 'coach') ->> 'error') = 'exists');
select public.qa('hamed: role from profile', public.my_kind() = 'coach');
do $$ declare n int; begin select count(*) into n from public.docs where path like 'academy/data/%'; perform public.qa('hamed (no players yet): sees no player data', n = 0); end $$;
do $$ declare n int; begin select count(*) into n from public.docs where path like 'academy/library/%' or path = 'academy/config'; perform public.qa('hamed: reads the drill library and settings', n = 2); end $$;

select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222"}', false) \g /dev/null
select public.qa('reza: registers as coach', (public.register_profile('reza', 'Reza', 'coach') ->> 'ok') = 'true');
select set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333"}', false) \g /dev/null
select public.qa('yaman: taken username refused', (public.register_profile('hamed', 'Yaman', 'family') ->> 'error') = 'username_taken');
select public.qa('yaman: bad username refused', (public.register_profile('ya man!', 'Yaman', 'family') ->> 'error') = 'bad_username');
select public.qa('yaman: registers as family (player)', (public.register_profile('yaman', 'Yaman', 'family', 2014, 'left', 'one') ->> 'ok') = 'true');
do $$ declare d jsonb; begin select data into d from public.docs where path = 'academy/data/players/33333333-3333-3333-3333-333333333333';
  perform public.qa('yaman: player made with the account id, born 2014, left-handed, 1HBH', d ->> 'id' = '33333333-3333-3333-3333-333333333333' and (d ->> 'birthYear')::int = 2014 and d ->> 'hand' = 'left' and d ->> 'backhand' = 'one' and d ->> 'username' = 'yaman'); end $$;
do $$ declare n int; begin select count(*) into n from public.docs where path like 'academy/data/%'; perform public.qa('yaman: sees only their own player', n = 1); end $$;
select set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-4444-444444444444"}', false) \g /dev/null
select public.qa('alya: registers as family', (public.register_profile('alya', 'Alya', 'family', 2013) ->> 'ok') = 'true');

-- search
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111"}', false) \g /dev/null
select public.qa('hamed: search "ya" finds player yaman only', (select array_agg(username) from public.search_profiles('ya')) = array['yaman']);
select public.qa('hamed: search finds by name too ("Aly")', (select array_agg(username) from public.search_profiles('Aly')) = array['alya']);
select public.qa('hamed: a coach does not find coaches', (select count(*) from public.search_profiles('re')) = 0);
select public.qa('hamed: one letter returns nothing', (select count(*) from public.search_profiles('y')) = 0);
select public.qa('hamed: "%" and "_" are not wildcards', (select count(*) from public.search_profiles('%%')) = 0 and (select count(*) from public.search_profiles('__')) = 0);

-- coach → player request
select public.qa('hamed: request to yaman is pending', (public.send_request('yaman') ->> 'status') = 'pending');
select public.qa('hamed: search shows the request as sent', (select status || '/' || direction from public.search_profiles('yaman')) = 'pending/out');
do $$ declare n int; begin select count(*) into n from public.docs where path like 'academy/data/players/%'; perform public.qa('hamed: still sees nothing before acceptance', n = 0); end $$;
select set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333"}', false) \g /dev/null
select public.qa('yaman: sees the incoming request', (select status || '/' || direction || '/' || username from public.my_connections()) = 'pending/in/hamed');
select public.qa('yaman: accepts', (public.respond_request('hamed', true) ->> 'status') = 'accepted');
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111"}', false) \g /dev/null
do $$ declare n int; begin select count(*) into n from public.docs where path like 'academy/data/players/%'; perform public.qa('hamed: now sees yaman''s player (only)', n = 1); end $$;
select public.qa('hamed: my_connections shows yaman with player id', (select username || '/' || status || '/' || player_id from public.my_connections()) = 'yaman/accepted/33333333-3333-3333-3333-333333333333');
-- the coach plans and edits through the same upsert the app uses
do $$ begin
  insert into public.docs (path, data) values ('academy/data/plans/plan-y', '{"id":"plan-y","playerId":"33333333-3333-3333-3333-333333333333","owner":"coach","createdAt":"x","sessions":[]}')
    on conflict (path) do update set data = excluded.data;
  insert into public.docs (path, data) values ('academy/data/players/33333333-3333-3333-3333-333333333333', (select data || '{"level":"advanced"}' from public.docs where path = 'academy/data/players/33333333-3333-3333-3333-333333333333'))
    on conflict (path) do update set data = excluded.data;
  insert into public.docs (path, data) values ('academy/data/matches/m-y', '{"id":"m-y","playerId":"33333333-3333-3333-3333-333333333333","date":"2026-11-02","points":[],"scorerId":"11111111-1111-1111-1111-111111111111","scorerRole":"coach"}')
    on conflict (path) do update set data = excluded.data;
  perform public.qa('hamed: plans, edits the player and charts a match (upsert)', true);
exception when others then perform public.qa('hamed: plans, edits the player and charts a match (upsert): ' || sqlerrm, false); end $$;
do $$ begin insert into public.docs (path, data) values ('academy/data/plans/plan-a', '{"id":"plan-a","playerId":"44444444-4444-4444-4444-444444444444"}') on conflict (path) do update set data = excluded.data;
  perform public.qa('hamed: cannot write for alya (not connected)', false);
exception when insufficient_privilege then perform public.qa('hamed: cannot write for alya (not connected)', true); end $$;
do $$ declare n int; begin update public.docs set data = jsonb_set(data, '{playerId}', '"44444444-4444-4444-4444-444444444444"') where path = 'academy/data/plans/plan-y';
  perform public.qa('hamed: cannot move a plan to alya', false);
exception when insufficient_privilege then perform public.qa('hamed: cannot move a plan to alya', true); end $$;
do $$ declare n int; begin delete from public.docs where path = 'academy/data/players/33333333-3333-3333-3333-333333333333'; get diagnostics n = row_count; perform public.qa('hamed: cannot delete a family''s player', n = 0); end $$;
do $$ begin insert into public.docs (path, data) values ('academy/data/players/44444444-4444-4444-4444-444444444444', '{"id":"x","ownerId":"11111111-1111-1111-1111-111111111111"}') on conflict (path) do update set data = excluded.data;
  perform public.qa('hamed: cannot take over alya''s player by claiming to own it', false);
exception when insufficient_privilege then perform public.qa('hamed: cannot take over alya''s player by claiming to own it', true); end $$;
-- a player without an account
do $$ begin insert into public.docs (path, data) values ('academy/data/players/player-kid', '{"id":"player-kid","name":"Kid","ownerId":"11111111-1111-1111-1111-111111111111"}') on conflict (path) do update set data = excluded.data;
  insert into public.docs (path, data) values ('academy/data/logs/log-k', '{"id":"log-k","playerId":"player-kid"}') on conflict (path) do update set data = excluded.data;
  perform public.qa('hamed: adds a player without an account, and logs for them', true);
exception when others then perform public.qa('hamed: adds a player without an account: ' || sqlerrm, false); end $$;
do $$ begin insert into public.docs (path, data) values ('academy/data/players/player-fake', '{"id":"player-fake","ownerId":"22222222-2222-2222-2222-222222222222"}');
  perform public.qa('hamed: cannot add a player in another coach''s name', false);
exception when insufficient_privilege then perform public.qa('hamed: cannot add a player in another coach''s name', true); end $$;

-- the other coach sees none of it
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222"}', false) \g /dev/null
do $$ declare n int; begin select count(*) into n from public.docs where path like 'academy/data/%'; perform public.qa('reza: sees no players, plans or matches of hamed', n = 0); end $$;
do $$ declare n int; begin update public.docs set data = '{}' where path like 'academy/data/%'; get diagnostics n = row_count; perform public.qa('reza: changes nothing', n = 0); end $$;

-- family side: sees the coach's plan and match, cannot write directly, charts their own match via the function
select set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333"}', false) \g /dev/null
do $$ declare n int; begin select count(*) into n from public.docs where path like 'academy/data/%'; perform public.qa('yaman: sees own player + plan + match (3)', n = 3); end $$;
do $$ begin insert into public.docs (path, data) values ('academy/data/plans/plan-z', '{"id":"plan-z","playerId":"33333333-3333-3333-3333-333333333333"}');
  perform public.qa('yaman: cannot write documents directly', false);
exception when insufficient_privilege then perform public.qa('yaman: cannot write documents directly', true); end $$;
select public.qa('yaman: charts own match', (public.family_save_match('{"id":"m-f","playerId":"33333333-3333-3333-3333-333333333333","date":"2026-11-02","points":["a"]}') ->> 'ok') = 'true');
select public.qa('yaman: cannot chart the coach''s match', (public.family_save_match('{"id":"m-y","playerId":"33333333-3333-3333-3333-333333333333","points":["z"]}') ->> 'error') = 'not_scorer');
select public.qa('yaman: cannot chart for another player', (public.family_save_match('{"id":"m-g","playerId":"44444444-4444-4444-4444-444444444444","points":[]}') ->> 'error') = 'not_linked');
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111"}', false) \g /dev/null
do $$ declare n int; begin select count(*) into n from public.docs where path = 'academy/data/matches/m-f'; perform public.qa('hamed: sees yaman''s live match', n = 1); end $$;
do $$ begin insert into public.docs (path, data) values ('academy/data/matches/m-f', (select data || '{"scorerId":"11111111-1111-1111-1111-111111111111","scorerRole":"coach"}' from public.docs where path = 'academy/data/matches/m-f')) on conflict (path) do update set data = excluded.data;
  perform public.qa('hamed: takes over the scoring', true);
exception when others then perform public.qa('hamed: takes over the scoring: ' || sqlerrm, false); end $$;
select set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333"}', false) \g /dev/null
select public.qa('yaman: after take over, cannot write it', (public.family_save_match('{"id":"m-f","playerId":"33333333-3333-3333-3333-333333333333","points":["b"]}') ->> 'error') = 'not_scorer');

-- family → coach request, auto-accept when both asked
select set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-4444-444444444444"}', false) \g /dev/null
select public.qa('alya: finds coach hamed', (select array_agg(username) from public.search_profiles('ham')) = array['hamed']);
select public.qa('alya: a family does not find families', (select count(*) from public.search_profiles('yam')) = 0);
select public.qa('alya: asks hamed', (public.send_request('hamed') ->> 'status') = 'pending');
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111"}', false) \g /dev/null
select public.qa('hamed: asking alya back accepts her request', (public.send_request('alya') ->> 'status') = 'accepted');
do $$ declare n int; begin select count(*) into n from public.docs where path like 'academy/data/players/%' and data -> 'archived' is distinct from 'true'::jsonb; perform public.qa('hamed: now sees yaman, alya and his own player (3)', n = 3); end $$;
-- link the player without an account to alya
select public.qa('hamed: links his player to alya''s account', (public.merge_offline_player('player-kid', 'alya') ->> 'moved')::int = 1);
do $$ declare n int; begin select count(*) into n from public.docs where path = 'academy/data/logs/log-k' and data ->> 'playerId' = '44444444-4444-4444-4444-444444444444'; perform public.qa('the old player''s results now belong to alya', n = 1); end $$;
do $$ declare n int; begin select count(*) into n from public.docs where path = 'academy/data/players/player-kid'; perform public.qa('the old entry is hidden from the coach (archived)', n = 0); end $$;

-- removing a connection stops access at once
select set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333"}', false) \g /dev/null
select public.qa('yaman: removes hamed', (public.remove_connection('hamed') ->> 'status') = 'removed');
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111"}', false) \g /dev/null
do $$ declare n int; begin select count(*) into n from public.docs where data ->> 'playerId' = '33333333-3333-3333-3333-333333333333' or path like '%33333333-3333-3333-3333-333333333333'; perform public.qa('hamed: lost access to yaman''s data', n = 0); end $$;
do $$ declare n int; begin update public.docs set data = data where data ->> 'playerId' = '33333333-3333-3333-3333-333333333333'; get diagnostics n = row_count; perform public.qa('hamed: cannot change yaman''s data any more', n = 0); end $$;
select public.qa('hamed: can ask again (pending)', (public.send_request('yaman') ->> 'status') = 'pending');
select set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333"}', false) \g /dev/null
select public.qa('yaman: declines', (public.respond_request('hamed', false) ->> 'status') = 'declined');
select public.qa('yaman: no open requests left', (select count(*) from public.my_connections()) = 0);

-- admin sees everything, including the older player
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a"}', false) \g /dev/null
do $$ declare n int; begin select count(*) into n from public.docs where path like 'academy/data/players/%'; perform public.qa('admin: sees every player (old, yaman, alya, kid)', n = 4); end $$;
select public.qa('admin: members list with emails (5)', (select count(*) from public.admin_profiles()) = 5 and (select email from public.admin_profiles() where username = 'yaman') = 'yaman@example.com');
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111"}', false) \g /dev/null
select public.qa('a coach cannot list members', (select count(*) from public.admin_profiles()) = 0);
reset role;

set role anon;
select set_config('request.jwt.claims', '', false) \g /dev/null
do $$ begin perform public.search_profiles('ya'); perform public.qa('anon: cannot search', false); exception when insufficient_privilege then perform public.qa('anon: cannot search', true); end $$;
do $$ declare n int; begin select count(*) into n from public.docs; perform public.qa('anon: reads nothing', n = 0); end $$;
reset role;
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-4444-444444444444"}', false) \g /dev/null
do $$ begin perform public.player_invite('x'); perform public.qa('old pairing functions are closed', false); exception when insufficient_privilege then perform public.qa('old pairing functions are closed', true); end $$;
do $$ declare n int; begin select count(*) into n from public.profiles; perform public.qa('profiles table is not readable directly', n = 0); end $$;
reset role;
\pset tuples_only on
\pset format unaligned
select (case when ok is true then 'PASS  ' else 'FAIL  ' end) || label from public.qa_results order by n;
select '---- ' || count(*) filter (where ok is true) || ' passed, ' || count(*) filter (where ok is not true) || ' failed' from public.qa_results;
