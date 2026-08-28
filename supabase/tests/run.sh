#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Runs the SIAB database test suite against a throwaway Postgres cluster.
# Applies the Supabase shim, then every migration, then every test file.
#
#   ./supabase/tests/run.sh
#
# Requires: postgresql-16, postgresql-16-postgis-3
# ---------------------------------------------------------------------------
set -euo pipefail

PGBIN=${PGBIN:-/usr/lib/postgresql/16/bin}
PGDATA=${PGDATA:-/var/lib/postgresql/siabtest}
PGPORT=${PGPORT:-55432}
PGHOST=${PGHOST:-/tmp}
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

if ! "$PGBIN/pg_isready" -h "$PGHOST" -p "$PGPORT" >/dev/null 2>&1; then
  echo "==> starting test cluster on port $PGPORT"
  rm -rf "$PGDATA"
  install -d -o postgres -g postgres "$(dirname "$PGDATA")"
  su postgres -c "$PGBIN/initdb -D $PGDATA -A trust -U postgres" >/dev/null
  su postgres -c "$PGBIN/pg_ctl -D $PGDATA -o '-p $PGPORT -k $PGHOST' -l /tmp/siab-pg.log start -w" >/dev/null
fi

PSQL="psql -h $PGHOST -p $PGPORT -U postgres -v ON_ERROR_STOP=1 -q"

echo "==> resetting database"
$PSQL -c "drop database if exists siab;" -c "create database siab;" >/dev/null
$PSQL -d siab -f "$ROOT/supabase/tests/_supabase_shim.sql" >/dev/null

echo "==> applying migrations"
for f in "$ROOT"/supabase/migrations/*.sql; do
  printf '    %-40s' "$(basename "$f")"
  $PSQL -d siab -f "$f" >/dev/null
  echo "ok"
done

echo "==> running tests"
failed=0
for f in "$ROOT"/supabase/tests/[0-9]*.sql; do
  echo "    $(basename "$f")"
  if out=$(psql -h "$PGHOST" -p "$PGPORT" -U postgres -d siab -v ON_ERROR_STOP=1 -f "$f" 2>&1); then
    echo "$out" | grep -oE 'TEST [0-9-]+ passed: .*' | sed 's/^/      ✓ /'
  else
    failed=1
    echo "$out" | grep -E 'ERROR|FAILED' | sed 's/^/      ✗ /'
  fi
done

if [ "$failed" -ne 0 ]; then echo "==> FAILED"; exit 1; fi
echo "==> all tests passed"
