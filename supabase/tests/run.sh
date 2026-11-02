#!/usr/bin/env bash
# Checks the access rules and functions in a throwaway local PostgreSQL (16+), with the real SQL files:
#   bash supabase/tests/run.sh
# stub.sql stands in for Supabase's auth schema (auth.uid() reads request.jwt.claims). Run as a user
# that can start PostgreSQL (as root it switches to the postgres user). Nothing outside a temp folder is touched.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
sql="$(dirname "$here")"
bin="${PG_BIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
[ -x "$bin/initdb" ] || bin="$(dirname "$(command -v initdb)")"
run() { if [ "$(id -u)" = 0 ]; then su postgres -s /bin/bash -c "$*"; else bash -c "$*"; fi; }
dir="$(mktemp -d /tmp/pgtest-XXXXXX)"
chmod 777 "$dir"
cp "$sql"/academy.sql "$sql"/coach-requests.sql "$sql"/subscriptions.sql "$sql"/invites.sql "$sql"/family-matches.sql \
   "$sql"/staff-codes.sql "$sql"/social.sql "$here"/stub.sql "$here"/social-test.sql "$here"/del-test.sql "$dir"/
chmod 644 "$dir"/*.sql
port=5499
run "'$bin/initdb' -D '$dir/data' -A trust -U postgres >/dev/null"
run "'$bin/pg_ctl' -D '$dir/data' -o \"-p $port -k $dir -c listen_addresses=''\" -l '$dir/pg.log' -w start >/dev/null"
trap 'run "\"$bin/pg_ctl\" -D \"$dir/data\" -m fast -w stop >/dev/null" || true; rm -rf "$dir"' EXIT
psql() { run "'$bin/psql' -h '$dir' -p $port -U postgres -d postgres -v ON_ERROR_STOP=1 -q $*"; }
for f in stub academy coach-requests subscriptions invites family-matches staff-codes social; do psql "-f '$dir/$f.sql'" >/dev/null; done
psql "-f '$dir/social-test.sql'" >/dev/null
psql "-At -c \"select format('usernames and connections: %s of %s passed', count(*) filter (where ok), count(*)) from public.qa_results\""
psql "-At -c \"select '  FAILED: ' || label from public.qa_results where ok is not true order by n\""
f1=$(psql "-At -c \"select count(*) from public.qa_results where ok is not true\"")
psql "-f '$dir/del-test.sql'" >/dev/null
psql "-At -c \"select format('account deletion: %s of %s passed', count(*) filter (where ok), count(*)) from public.qa_results\""
psql "-At -c \"select '  FAILED: ' || label from public.qa_results where ok is not true order by n\""
f2=$(psql "-At -c \"select count(*) from public.qa_results where ok is not true\"")
[ "$f1" = 0 ] && [ "$f2" = 0 ]
