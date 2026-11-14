#!/usr/bin/env bash
# يشغّل المخطط على Postgres مؤقت ويختبره: bash supabase/tests/run.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
DIR="$(mktemp -d)"
trap '"$PGBIN/pg_ctl" -D "$DIR/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$DIR"' EXIT
if [ "$(id -u)" = 0 ]; then chown -R postgres "$DIR"; RUN=(runuser -u postgres --); else RUN=(); fi
"${RUN[@]}" "$PGBIN/initdb" -D "$DIR/data" -U postgres -A trust >/dev/null
"${RUN[@]}" "$PGBIN/pg_ctl" -D "$DIR/data" -o "-k $DIR -c listen_addresses=''" -l "$DIR/log" -w start >/dev/null
export PGOPTIONS="-c client_min_messages=warning"
PSQL=("${RUN[@]}" env PGOPTIONS="$PGOPTIONS" "$PGBIN/psql" -h "$DIR" -U postgres -d postgres -v ON_ERROR_STOP=1 -q)
"${PSQL[@]}" -f supabase/tests/stubs.sql
for f in supabase/migrations/*.sql; do "${PSQL[@]}" -f "$f"; done
"${PSQL[@]}" -f supabase/setup.sql   # الملف المجمّع (ما يلصقه صاحب الخادم)، وإعادة التشغيل آمنة
"${PSQL[@]}" -t -f supabase/tests/rls.sql
