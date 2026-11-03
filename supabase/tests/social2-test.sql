\set QUIET on
\set VERBOSITY terse
-- Runs after social-test.sql and del-test.sql, with supabase/social-2.sql applied on top.
delete from public.qa_results;
insert into auth.users (id, email) values
 ('55555555-5555-5555-5555-555555555555', 'coach1@example.com'),
 ('66666666-6666-6666-6666-666666666666', 'coach2@example.com'),
 ('77777777-7777-7777-7777-777777777777', 'fam1@example.com'),
 ('88888888-8888-8888-8888-888888888888', 'fam2@example.com'),
 ('99999999-9999-9999-9999-999999999999', 'old@example.com');
-- an account from before consents (no consent recorded)
insert into public.profiles (user_id, username, display_name, kind) values ('99999999-9999-9999-9999-999999999999', 'oldfam', 'Old Family', 'family');
insert into public.docs (path, data) values ('academy/data/plans/legacy-p0', '{"id":"legacy-p0","playerId":"77777777-7777-7777-7777-777777777777"}');

set role authenticated;
-- ---------- sign-up with consent ----------
select set_config('request.jwt.claims', '{"sub":"55555555-5555-5555-5555-555555555555"}', false) \g /dev/null
select public.qa('sign-up without consent is refused', (public.register_profile_v2('coachone', 'Coach One', 'coach', null, null, null, null) ->> 'error') = 'consent_required');
select public.qa('coach one registers with consent', (public.register_profile_v2('coachone', 'Coach One', 'coach', null, false, null, 'privacy-2026-11') ->> 'ok') = 'true');
select public.qa('coach is always findable by name', (public.my_profile() ->> 'discoverable') = 'true' and (public.my_profile() ->> 'consentAt') is not null);
select set_config('request.jwt.claims', '{"sub":"66666666-6666-6666-6666-666666666666"}', false) \g /dev/null
select public.qa('coach two registers', (public.register_profile_v2('coachtwo', 'Coach Two', 'coach', null, null, null, 'privacy-2026-11') ->> 'ok') = 'true');
select set_config('request.jwt.claims', '{"sub":"77777777-7777-7777-7777-777777777777"}', false) \g /dev/null
select public.qa('family without the guardian confirmation is refused', (public.register_profile_v2('famone', 'First Family', 'family', 2014, false, false, 'privacy-2026-11') ->> 'error') = 'guardian_required');
select public.qa('family one registers (not findable by name)', (public.register_profile_v2('famone', 'First Family', 'family', 2014, false, true, 'privacy-2026-11') ->> 'ok') = 'true');
select public.qa('family profile: guardian, not discoverable', (public.my_profile() ->> 'guardian') = 'true' and (public.my_profile() ->> 'discoverable') = 'false');
do $$ declare d jsonb; begin select data into d from public.docs where path = 'academy/data/players/77777777-7777-7777-7777-777777777777';
  perform public.qa('family player starts with AI analysis off', d -> 'aiConsent' = 'false'::jsonb and (d ->> 'birthYear')::int = 2014); end $$;
select set_config('request.jwt.claims', '{"sub":"88888888-8888-8888-8888-888888888888"}', false) \g /dev/null
select public.qa('family two registers (findable by name)', (public.register_profile_v2('famtwo', 'Second Family', 'family', 2012, true, true, 'privacy-2026-11') ->> 'ok') = 'true');
select public.qa('old sign-up function is closed', not has_function_privilege('authenticated', 'public.register_profile(text,text,text,int,text,text)', 'execute'));

-- ---------- search privacy ----------
select set_config('request.jwt.claims', '{"sub":"55555555-5555-5555-5555-555555555555"}', false) \g /dev/null
select public.qa('coach: a family that is not findable by name stays hidden ("fam")', (select array_agg(username order by username) from public.search_people('fam')) = array['famtwo']);
select public.qa('coach: by name only the family that allowed it ("second")', (select array_agg(username) from public.search_people('second')) = array['famtwo']);
select public.qa('coach: "first" finds nothing (hidden family)', (select count(*) from public.search_people('first')) = 0);
select public.qa('coach: the exact username finds the hidden family', (select array_agg(username) from public.search_people('famone')) = array['famone']);
select public.qa('old search follows the same rule', (select array_agg(username order by username) from public.search_profiles('fam')) = array['famtwo']);
select set_config('request.jwt.claims', '{"sub":"77777777-7777-7777-7777-777777777777"}', false) \g /dev/null
select public.qa('family: coaches are found by name', (select array_agg(username order by username) from public.search_people('coach')) = array['coachone', 'coachtwo']);

-- ---------- requests: 30-day pause after a decline or a disconnect ----------
select set_config('request.jwt.claims', '{"sub":"55555555-5555-5555-5555-555555555555"}', false) \g /dev/null
select public.qa('coach one asks family one', (public.send_request('famone') ->> 'status') = 'pending');
select set_config('request.jwt.claims', '{"sub":"77777777-7777-7777-7777-777777777777"}', false) \g /dev/null
select public.qa('family one declines', (public.respond_request('coachone', false) ->> 'status') = 'declined');
select set_config('request.jwt.claims', '{"sub":"55555555-5555-5555-5555-555555555555"}', false) \g /dev/null
select public.qa('declined coach must wait 30 days', (public.send_request('famone') ->> 'error') = 'wait');
select set_config('request.jwt.claims', '{"sub":"77777777-7777-7777-7777-777777777777"}', false) \g /dev/null
select public.qa('the family can still ask that coach', (public.send_request('coachone') ->> 'status') = 'pending');
select set_config('request.jwt.claims', '{"sub":"55555555-5555-5555-5555-555555555555"}', false) \g /dev/null
select public.qa('coach accepts', (public.respond_request('famone', true) ->> 'status') = 'accepted');
select set_config('request.jwt.claims', '{"sub":"77777777-7777-7777-7777-777777777777"}', false) \g /dev/null
select public.qa('family disconnects', (public.remove_connection('coachone') ->> 'status') = 'removed');
select set_config('request.jwt.claims', '{"sub":"55555555-5555-5555-5555-555555555555"}', false) \g /dev/null
select public.qa('disconnected coach must wait too', (public.send_request('famone') ->> 'error') = 'wait');
select set_config('request.jwt.claims', '{"sub":"77777777-7777-7777-7777-777777777777"}', false) \g /dev/null
select public.qa('family reconnects', (public.send_request('coachone') ->> 'status') = 'pending');
select set_config('request.jwt.claims', '{"sub":"55555555-5555-5555-5555-555555555555"}', false) \g /dev/null
select public.qa('coach accepts again', (public.respond_request('famone', true) ->> 'status') = 'accepted');
select set_config('request.jwt.claims', '{"sub":"66666666-6666-6666-6666-666666666666"}', false) \g /dev/null
select public.qa('coach two asks family one', (public.send_request('famone') ->> 'status') = 'pending');
select public.qa('coach two withdraws', (public.remove_connection('famone') ->> 'status') = 'removed');
select public.qa('the coach who withdrew may ask again at once', (public.send_request('famone') ->> 'status') = 'pending');
select set_config('request.jwt.claims', '{"sub":"77777777-7777-7777-7777-777777777777"}', false) \g /dev/null
select public.qa('family accepts coach two', (public.respond_request('coachtwo', true) ->> 'status') = 'accepted');

-- ---------- only the creator deletes ----------
select set_config('request.jwt.claims', '{"sub":"55555555-5555-5555-5555-555555555555"}', false) \g /dev/null
do $$ begin insert into public.docs (path, data) values ('academy/data/plans/p1', '{"id":"p1","playerId":"77777777-7777-7777-7777-777777777777","createdBy":"55555555-5555-5555-5555-555555555555"}');
  insert into public.docs (path, data) values ('academy/data/plans/p1b', '{"id":"p1b","playerId":"77777777-7777-7777-7777-777777777777","createdBy":"55555555-5555-5555-5555-555555555555"}');
  perform public.qa('coach one creates plans signed as themselves', true);
exception when others then perform public.qa('coach one creates plans: ' || sqlerrm, false); end $$;
do $$ begin insert into public.docs (path, data) values ('academy/data/plans/p-fake', '{"id":"p-fake","playerId":"77777777-7777-7777-7777-777777777777","createdBy":"66666666-6666-6666-6666-666666666666"}');
  perform public.qa('a plan cannot claim another creator', false);
exception when insufficient_privilege then perform public.qa('a plan cannot claim another creator', true); end $$;
select set_config('request.jwt.claims', '{"sub":"66666666-6666-6666-6666-666666666666"}', false) \g /dev/null
do $$ declare n int; begin delete from public.docs where path = 'academy/data/plans/p1'; get diagnostics n = row_count; perform public.qa('another coach cannot delete it', n = 0); end $$;
do $$ declare d jsonb; begin update public.docs set data = data || '{"createdBy":"66666666-6666-6666-6666-666666666666","name":"edited"}' where path = 'academy/data/plans/p1';
  select data into d from public.docs where path = 'academy/data/plans/p1';
  perform public.qa('another coach can edit it, but not take its authorship', d ->> 'name' = 'edited' and d ->> 'createdBy' = '55555555-5555-5555-5555-555555555555'); end $$;
do $$ declare n int; begin delete from public.docs where path = 'academy/data/plans/legacy-p0'; get diagnostics n = row_count; perform public.qa('an older plan without a creator can be deleted by a connected coach', n = 1); end $$;
select set_config('request.jwt.claims', '{"sub":"55555555-5555-5555-5555-555555555555"}', false) \g /dev/null
do $$ declare n int; begin delete from public.docs where path = 'academy/data/plans/p1b'; get diagnostics n = row_count; perform public.qa('the creator deletes their plan', n = 1); end $$;

-- ---------- family edits its player ----------
select set_config('request.jwt.claims', '{"sub":"77777777-7777-7777-7777-777777777777"}', false) \g /dev/null
select public.qa('family edits name, birth year, AI choice (level ignored)', (public.family_update_player('{"name":"Fam One New","birthYear":2013,"aiConsent":true,"level":"advanced"}') ->> 'ok') = 'true');
do $$ declare d jsonb; begin select data into d from public.docs where path = 'academy/data/players/77777777-7777-7777-7777-777777777777';
  perform public.qa('player updated; level stays the coach''s', d ->> 'name' = 'Fam One New' and (d ->> 'birthYear')::int = 2013 and d -> 'aiConsent' = 'true'::jsonb and d ->> 'level' = 'beginner'); end $$;
select public.qa('the account name follows the player name', (public.my_profile() ->> 'displayName') = 'Fam One New');
select public.qa('impossible birth year refused', (public.family_update_player('{"birthYear":1900}') ->> 'error') = 'bad_year');
select public.qa('username taken refused', (public.change_username('famtwo') ->> 'error') = 'username_taken');
select public.qa('family changes username', (public.change_username('famone2') ->> 'username') = 'famone2');
do $$ declare d jsonb; begin select data into d from public.docs where path = 'academy/data/players/77777777-7777-7777-7777-777777777777';
  perform public.qa('player record has the new username', d ->> 'username' = 'famone2'); end $$;
select public.qa('family allows being found by name', (public.update_my_profile(null, true, null) ->> 'ok') = 'true');
select set_config('request.jwt.claims', '{"sub":"66666666-6666-6666-6666-666666666666"}', false) \g /dev/null
select public.qa('now a coach finds it by name', (select count(*) from public.search_people('fam one')) = 1);
select public.qa('a coach cannot use the family edit', (public.family_update_player('{"name":"x"}') ->> 'error') = 'not_family');

-- ---------- moving a player without an account: the family allows it ----------
select set_config('request.jwt.claims', '{"sub":"55555555-5555-5555-5555-555555555555"}', false) \g /dev/null
do $$ begin insert into public.docs (path, data) values ('academy/data/players/off1', '{"id":"off1","name":"Offline One","ownerId":"55555555-5555-5555-5555-555555555555","level":"advanced","goals":"serve"}');
  insert into public.docs (path, data) values ('academy/data/plans/off1-plan', '{"id":"off1-plan","playerId":"off1","createdBy":"55555555-5555-5555-5555-555555555555"}');
  insert into public.docs (path, data) values ('academy/data/players/off2', '{"id":"off2","name":"Offline Two","ownerId":"55555555-5555-5555-5555-555555555555"}');
  perform public.qa('coach adds two players without an account', true);
exception when others then perform public.qa('coach adds players without an account: ' || sqlerrm, false); end $$;
select public.qa('the direct move is for the admin only now', (public.merge_offline_player('off1', 'famone2') ->> 'error') = 'not_allowed');
select public.qa('not connected to family two: refused', (public.request_link('off1', 'famtwo') ->> 'error') = 'not_connected');
select public.qa('coach asks family one to take Offline One', (public.request_link('off1', 'famone2') ->> 'ok') = 'true');
select public.qa('asking twice keeps one request', (public.request_link('off1', 'famone2') ->> 'ok') = 'true' and (select count(*) from public.my_link_requests()) = 1);
select public.qa('coach asks about Offline Two too', (public.request_link('off2', 'famone2') ->> 'ok') = 'true');
do $$ declare n int; begin select count(*) into n from public.docs where data ->> 'playerId' = 'off1'; perform public.qa('nothing moves before the family answers', n = 1); end $$;
select set_config('request.jwt.claims', '{"sub":"77777777-7777-7777-7777-777777777777"}', false) \g /dev/null
select public.qa('family sees both requests', (select count(*) from public.my_link_requests() where direction = 'in') = 2);
select public.qa('family accepts Offline One', (public.respond_link((select id from public.my_link_requests() where offline_name = 'Offline One'), true) ->> 'moved') = '1');
select public.qa('family declines Offline Two', (public.respond_link((select id from public.my_link_requests() where offline_name = 'Offline Two'), false) ->> 'status') = 'declined');
reset role;
select public.qa('the plan moved to the family; Offline One archived; Offline Two untouched',
  (select data ->> 'playerId' from public.docs where path = 'academy/data/plans/off1-plan') = '77777777-7777-7777-7777-777777777777'
  and (select data -> 'archived' from public.docs where path = 'academy/data/players/off1') = 'true'::jsonb
  and (select data -> 'archived' from public.docs where path = 'academy/data/players/off2') is null
  and (select data ->> 'level' from public.docs where path = 'academy/data/players/77777777-7777-7777-7777-777777777777') = 'advanced');
set role authenticated;

-- ---------- matches charted by the family ----------
select set_config('request.jwt.claims', '{"sub":"77777777-7777-7777-7777-777777777777"}', false) \g /dev/null
select public.qa('family charts a match', (public.family_save_match('{"id":"fm1","playerId":"77777777-7777-7777-7777-777777777777","points":[]}') ->> 'ok') = 'true');
do $$ declare d jsonb; begin select data into d from public.docs where path = 'academy/data/matches/fm1';
  perform public.qa('the family is its creator', d ->> 'createdBy' = '77777777-7777-7777-7777-777777777777'); end $$;
select set_config('request.jwt.claims', '{"sub":"55555555-5555-5555-5555-555555555555"}', false) \g /dev/null
do $$ declare n int; begin delete from public.docs where path = 'academy/data/matches/fm1'; get diagnostics n = row_count; perform public.qa('a coach cannot delete the family''s match', n = 0); end $$;
do $$ begin insert into public.docs (path, data) values ('academy/data/matches/cm1', '{"id":"cm1","playerId":"77777777-7777-7777-7777-777777777777","createdBy":"55555555-5555-5555-5555-555555555555","scorerId":"55555555-5555-5555-5555-555555555555"}');
  perform public.qa('coach charts a match', true);
exception when others then perform public.qa('coach charts a match: ' || sqlerrm, false); end $$;
select set_config('request.jwt.claims', '{"sub":"77777777-7777-7777-7777-777777777777"}', false) \g /dev/null
select public.qa('family removes its own match', (public.family_delete_match('fm1') ->> 'ok') = 'true');
select public.qa('family cannot remove the coach''s match', (public.family_delete_match('cm1') ->> 'error') = 'not_found');
do $$ declare d jsonb; begin select data into d from public.docs where path = 'academy/data/matches/fm1';
  perform public.qa('the removed match is hidden, not lost', d ? 'deletedAt' and d ->> 'createdBy' = '77777777-7777-7777-7777-777777777777'); end $$;

-- ---------- admin: verify and block ----------
select set_config('request.jwt.claims', '{"sub":"55555555-5555-5555-5555-555555555555"}', false) \g /dev/null
select public.qa('a coach cannot use the admin tools', (public.admin_set_flags('coachtwo', true, null) ->> 'error') = 'not_admin' and (select count(*) from public.admin_profiles_v2()) = 0);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a"}', false) \g /dev/null
select public.qa('admin verifies coach two', (public.admin_set_flags('coachtwo', null, true) ->> 'ok') = 'true');
select public.qa('admin blocks coach one', (public.admin_set_flags('coachone', true, null) ->> 'ok') = 'true');
select public.qa('admin cannot block staff', (public.admin_set_flags('farhang', true, null) ->> 'error') = 'staff');
select public.qa('admin sees flags, consent and guardian', (select count(*) from public.admin_profiles_v2() where username = 'coachone' and blocked) = 1
  and (select count(*) from public.admin_profiles_v2() where username = 'famone2' and guardian and consent_at is not null) = 1);
select set_config('request.jwt.claims', '{"sub":"55555555-5555-5555-5555-555555555555"}', false) \g /dev/null
do $$ declare n int; begin select count(*) into n from public.docs where path like 'academy/data/%'; perform public.qa('blocked coach sees no player data', n = 0); end $$;
select public.qa('blocked coach cannot search or ask', (select count(*) from public.search_people('fam')) = 0 and (public.send_request('famtwo') ->> 'error') = 'blocked');
do $$ begin insert into public.docs (path, data) values ('academy/data/players/off9', '{"id":"off9","ownerId":"55555555-5555-5555-5555-555555555555"}');
  perform public.qa('blocked coach cannot add players', false);
exception when insufficient_privilege then perform public.qa('blocked coach cannot add players', true); end $$;
select set_config('request.jwt.claims', '{"sub":"77777777-7777-7777-7777-777777777777"}', false) \g /dev/null
select public.qa('families do not find the blocked coach; the verified coach comes first', (select array_agg(username) from public.search_people('coach')) = array['coachtwo']
  and (select verified from public.search_people('coachtwo')) is true);
select public.qa('connections show who is verified', (select verified from public.my_connections_v2() where username = 'coachtwo') is true);

-- ---------- push subscriptions ----------
select set_config('request.jwt.claims', '{"sub":"66666666-6666-6666-6666-666666666666"}', false) \g /dev/null
select public.qa('a device registers for notifications', (public.save_push_subscription('https://fcm.googleapis.com/fcm/send/abc', repeat('B', 87), repeat('a', 22), 'fa', 'test') ->> 'ok') = 'true');
select public.qa('a bad subscription is refused', (public.save_push_subscription('http://x', 'x', 'y', 'en', null) ->> 'error') = 'bad_subscription');
select public.qa('only real push services are accepted', (public.save_push_subscription('https://evil.example.com/hook', repeat('B', 87), repeat('a', 22), 'en', null) ->> 'error') = 'bad_subscription');
select public.qa('an Apple device registers', (public.save_push_subscription('https://web.push.apple.com/QGuQyavXutnMH', repeat('D', 87), repeat('d', 22), 'en', 'iPhone') ->> 'ok') = 'true');
select public.qa('a look-alike host is refused', (public.save_push_subscription('https://fcm.googleapis.com.evil.io/x', repeat('B', 87), repeat('a', 22), 'en', null) ->> 'error') = 'bad_subscription');
select set_config('request.jwt.claims', '{"sub":"77777777-7777-7777-7777-777777777777"}', false) \g /dev/null
select public.qa('the same device signed in as someone else moves to them', (public.save_push_subscription('https://fcm.googleapis.com/fcm/send/abc', repeat('C', 87), repeat('b', 22), 'en', 'test') ->> 'ok') = 'true');
select set_config('request.jwt.claims', '{"sub":"66666666-6666-6666-6666-666666666666"}', false) \g /dev/null
select public.disable_push_subscription('https://fcm.googleapis.com/fcm/send/abc') \g /dev/null
reset role;
select public.qa('only the device''s current person can turn it off', (select user_id::text || '/' || coalesce(disabled_at::text, 'on') from public.push_subscriptions where endpoint = 'https://fcm.googleapis.com/fcm/send/abc') = '77777777-7777-7777-7777-777777777777/on');
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"77777777-7777-7777-7777-777777777777"}', false) \g /dev/null
select public.disable_push_subscription('https://fcm.googleapis.com/fcm/send/abc') \g /dev/null
reset role;
select public.qa('the owner turns it off', (select disabled_at is not null from public.push_subscriptions where endpoint = 'https://fcm.googleapis.com/fcm/send/abc'));
set role authenticated;

-- ---------- consent for an account made before ----------
select set_config('request.jwt.claims', '{"sub":"99999999-9999-9999-9999-999999999999"}', false) \g /dev/null
select public.qa('older account has no consent yet', (public.my_profile() ->> 'consentAt') is null);
select public.qa('family consent needs the guardian confirmation', (public.give_consent(false, 'privacy-2026-11') ->> 'error') = 'guardian_required');
select public.qa('older account gives consent', (public.give_consent(true, 'privacy-2026-11') ->> 'ok') = 'true');
select public.qa('consent is recorded', (public.my_profile() ->> 'consentAt') is not null and (public.my_profile() ->> 'guardian') = 'true');
select public.qa('nobody calls the private merge helper', not has_function_privilege('authenticated', 'public.do_merge_offline(text,uuid)', 'execute'));
select public.qa('signed-in people cannot read the server keys', (select count(*) from public.app_keys) = 0);
reset role;
select public.qa('the app address for notifications is set', (select value from public.app_keys where name = 'app_url') like 'https://%');
