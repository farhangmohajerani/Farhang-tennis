\set QUIET on
\set VERBOSITY terse
-- Runs after social2-test.sql, with supabase/social-3.sql applied on top (the upgrade path).
delete from public.qa_results;

-- ---------- accounts from before ----------
select public.qa('older profiles get a first and last name', (select first_name || '|' || coalesce(last_name, '') from public.profiles where username = 'coachtwo') = 'Coach|Two');
select public.qa('older families are held by a parent', (select holder from public.profiles where username = 'famone2') = 'parent');
select public.qa('everyone is findable by name once', (select bool_and(discoverable) from public.profiles));
select public.qa('the one-time step is marked', exists (select 1 from public.app_keys where name = 'migrated_social_3'));

insert into auth.users (id, email) values
 ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'sara.coach@example.com'),
 ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'rad.family@example.com'),
 ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'ali.player@example.com'),
 ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'hidden.family@example.com');

set role authenticated;
-- ---------- sign-up: first and last name only ----------
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"}', false) \g /dev/null
select public.qa('a last name is needed', (public.register_profile_v3('Sara', '', 'coach', 'privacy-2026-11') ->> 'error') = 'bad_name');
select public.qa('consent is needed', (public.register_profile_v3('Sara', 'Nazari', 'coach', '') ->> 'error') = 'consent_required');
select public.qa('the kind must be coach, family or player', (public.register_profile_v3('Sara', 'Nazari', 'admin', 'privacy-2026-11') ->> 'error') = 'bad_kind');
select public.qa('a coach signs up with names only', (public.register_profile_v3('  Sara ', ' Nazari  ', 'coach', 'privacy-2026-11') ->> 'ok') = 'true');
select public.qa('names are kept tidy', (public.my_profile() ->> 'displayName') = 'Sara Nazari' and (public.my_profile() ->> 'firstName') = 'Sara' and (public.my_profile() ->> 'lastName') = 'Nazari');
select public.qa('a hidden internal id is made', (public.my_profile() ->> 'username') ~ '^u[0-9a-f]{11}$');
select public.qa('a second sign-up is refused', (public.register_profile_v3('Sara', 'Nazari', 'coach', 'privacy-2026-11') ->> 'error') = 'exists');
select public.qa('coach answers the profile (unknown and bad answers are dropped)', (public.update_my_profile_v2(null, null,
  '{"club":"Topspin Academy","city":"Ankara","yearsCoaching":"6-10","certifications":"WTA, GPTCA","hack":"x","bio":""}'::jsonb, null, null) ->> 'ok') = 'true');
select public.qa('coach details are stored cleanly', (public.my_profile() -> 'details') = '{"city":"Ankara","club":"Topspin Academy","yearsCoaching":"6-10","certifications":"WTA, GPTCA"}'::jsonb);
select public.update_my_profile_v2(null, null, '{"yearsCoaching":"forever"}'::jsonb, null, null) \g /dev/null
select public.qa('an answer outside the choices is ignored', (public.my_profile() -> 'details' ->> 'yearsCoaching') = '6-10');

select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"}', false) \g /dev/null
select public.qa('a family signs up with the player''s names', (public.register_profile_v3('Yaman', 'Rad', 'family', 'privacy-2026-11') ->> 'ok') = 'true');
select public.qa('family: held by a parent, findable, guardian', (public.my_profile() ->> 'holder') = 'parent' and (public.my_profile() ->> 'discoverable') = 'true' and (public.my_profile() ->> 'guardian') = 'true');
do $$ declare d jsonb; begin select data into d from public.docs where path = 'academy/data/players/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  perform public.qa('nothing is assumed about the player (no hand, backhand, level or birth year)',
    d -> 'hand' = 'null'::jsonb and d -> 'backhand' = 'null'::jsonb and d -> 'level' = 'null'::jsonb and d -> 'birthYear' = 'null'::jsonb
    and d ->> 'name' = 'Yaman Rad' and d -> 'aiConsent' = 'false'::jsonb); end $$;
select public.qa('the profile answers the player''s questions', (public.family_update_player(
  '{"birthYear":2014,"level":"intermediate","hand":"left","backhand":"two","yearsPlaying":"3-5","goals":"National juniors"}'::jsonb) ->> 'ok') = 'true');
do $$ declare d jsonb; begin select data into d from public.docs where path = 'academy/data/players/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  perform public.qa('the answers are saved', d ->> 'hand' = 'left' and d ->> 'level' = 'intermediate' and (d ->> 'birthYear')::int = 2014
    and d ->> 'yearsPlaying' = '3-5' and d ->> 'goals' = 'National juniors'); end $$;
select public.qa('a level outside the list is refused', (public.family_update_player('{"level":"godlike"}'::jsonb) ->> 'error') = 'bad_level');
select public.qa('years playing outside the list is refused', (public.family_update_player('{"yearsPlaying":"20"}'::jsonb) ->> 'error') = 'bad_years');
select public.qa('the parent''s name goes in the profile', (public.update_my_profile_v2(null, null, '{"parentName":"Leila Rad","club":"no"}'::jsonb, null, null) ->> 'ok') = 'true');
select public.qa('a family keeps only family answers', (public.my_profile() -> 'details') = '{"parentName":"Leila Rad"}'::jsonb);
select public.qa('renaming the player updates the player too', (public.update_my_profile_v2('Yaman', 'Rad-Ahmadi', null, null, null) ->> 'ok') = 'true');
do $$ declare d jsonb; begin select data into d from public.docs where path = 'academy/data/players/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  perform public.qa('the player shows the new name', d ->> 'name' = 'Yaman Rad-Ahmadi' and (public.my_profile() ->> 'displayName') = 'Yaman Rad-Ahmadi'); end $$;

select set_config('request.jwt.claims', '{"sub":"cccccccc-cccc-cccc-cccc-cccccccccccc"}', false) \g /dev/null
select public.qa('a player signs up for themself', (public.register_profile_v3('Ali', 'Ahmadi', 'player', 'privacy-2026-11') ->> 'ok') = 'true');
select public.qa('player: a family-type account held by the player, no guardian', (public.my_profile() ->> 'kind') = 'family' and (public.my_profile() ->> 'holder') = 'player' and (public.my_profile() ->> 'guardian') = 'false');
select public.qa('a player has one player record: their own', exists (select 1 from public.docs where path = 'academy/data/players/cccccccc-cccc-cccc-cccc-cccccccccccc'));

select set_config('request.jwt.claims', '{"sub":"dddddddd-dddd-dddd-dddd-dddddddddddd"}', false) \g /dev/null
select public.qa('another family signs up', (public.register_profile_v3('Nima', 'Karimi', 'family', 'privacy-2026-11') ->> 'ok') = 'true');
select public.qa('a family can stop being findable by name', (public.update_my_profile_v2(null, null, null, false, null) ->> 'ok') = 'true');
select public.qa('the choice is saved', (public.my_profile() ->> 'discoverable') = 'false');

-- ---------- finding each other by name ----------
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"}', false) \g /dev/null
select public.qa('coach finds a family by first name', (select array_agg(display_name) from public.search_people_v2('yam')) = array['Yaman Rad-Ahmadi']);
select public.qa('coach finds a family by last name (hyphens too)', (select array_agg(display_name) from public.search_people_v2('rad-a')) = array['Yaman Rad-Ahmadi']
  and (select array_agg(display_name) from public.search_people_v2('Rad')) = array['Yaman Rad-Ahmadi']);
select public.qa('coach finds by the full name', (select array_agg(display_name) from public.search_people_v2('yaman  rad')) = array['Yaman Rad-Ahmadi']);
select public.qa('coach finds a player by name, marked as a player', (select holder from public.search_people_v2('ahmadi') where display_name = 'Ali Ahmadi') = 'player');
select public.qa('a family that turned it off is not listed', (select count(*) from public.search_people_v2('nima')) = 0);
select public.qa('coaches are never listed to coaches', (select count(*) from public.search_people_v2('coach')) = 0);
select public.qa('one letter finds nothing', (select count(*) from public.search_people_v2('y')) = 0);
select public.qa('hidden ids do not find anyone', (select count(*) from public.search_people_v2((select username from public.profiles where user_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'))) = 0);
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"}', false) \g /dev/null
select public.qa('a family finds the coach by name, with club and city', (select club || ' · ' || city from public.search_people_v2('sara') where display_name = 'Sara Nazari') = 'Topspin Academy · Ankara');
select public.qa('a family''s own details are never shown to others', (select count(*) from public.search_people_v2('sara') where club is not null and kind <> 'coach') = 0);
select public.qa('Arabic and Persian letter forms match (ي and ی)', public.norm_name('علي') = public.norm_name('علی') and public.norm_name('كريم') = public.norm_name('کریم'));

-- ---------- connecting and the lists ----------
select public.qa('the family asks the coach (hidden id from the search)', (public.send_request((select username from public.search_people_v2('nazari') limit 1)) ->> 'status') = 'pending');
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"}', false) \g /dev/null
select public.qa('the coach sees the request with the family''s kind', (select holder || '/' || status || '/' || direction from public.my_connections_v3() where display_name = 'Yaman Rad-Ahmadi') = 'parent/pending/in');
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"}', false) \g /dev/null
select public.qa('the family sees the coach''s club in its list', (select club from public.my_connections_v3() where display_name = 'Sara Nazari') = 'Topspin Academy');

-- ---------- admin and closed doors ----------
select public.qa('a family cannot list members', (select count(*) from public.admin_profiles_v3()) = 0);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a"}', false) \g /dev/null
select public.qa('the admin sees who holds each account', (select holder from public.admin_profiles_v3() where display_name = 'Ali Ahmadi') = 'player'
  and (select email from public.admin_profiles_v3() where display_name = 'Sara Nazari') = 'sara.coach@example.com');
select public.qa('sign-up with a username is closed', not has_function_privilege('authenticated', 'public.register_profile_v2(text,text,text,int,boolean,boolean,text)', 'execute'));
select public.qa('nobody calls the internal helpers', not has_function_privilege('authenticated', 'public.new_username()', 'execute')
  and not has_function_privilege('authenticated', 'public.clean_details(text,text,jsonb,jsonb)', 'execute'));
reset role;
