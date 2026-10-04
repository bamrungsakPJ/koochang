#!/usr/bin/env bash
# Proves the latest backup restores: verifies the checksum, restores the dump into a scratch
# database on the same cluster, compares table count, migrations and row counts with the live
# database, then drops the scratch database. Run on the database host (as root or postgres).
#
#   BACKUP_DIR=/var/backups/field-service DB_NAME=field_service ./restore-check.sh [dump-file]
#
# Exit code 0 = restore proven. Record the output in the operations log (RTO measurement).
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/field-service}"
DB_NAME="${DB_NAME:-field_service}"
DB_PORT="${DB_PORT:-5432}"
PG_AS="${PG_AS:-postgres}"
SCRATCH="${DB_NAME}_restore_check"

run_pg() { if [ "$(id -un)" = "$PG_AS" ]; then "$@"; else sudo -n -u "$PG_AS" "$@"; fi; }
q() { run_pg psql -X -q -At -p "$DB_PORT" -d "$1" -c "$2"; }

dump="${1:-$(ls -1t "$BACKUP_DIR"/db-*.dump | head -1)}"
[ -f "$dump" ] || { echo "no dump found" >&2; exit 1; }
stamp="$(basename "$dump" .dump)"; stamp="${stamp#db-}"
if [ -f "$BACKUP_DIR/sums-$stamp.sha256" ]; then
  ( cd "$BACKUP_DIR" && grep " db-$stamp.dump" "sums-$stamp.sha256" | sha256sum -c --quiet - ) || { echo "checksum mismatch" >&2; exit 1; }
fi

started=$(date +%s)
q postgres "DROP DATABASE IF EXISTS $SCRATCH WITH (FORCE)"
q postgres "CREATE DATABASE $SCRATCH TEMPLATE template0"
trap 'q postgres "DROP DATABASE IF EXISTS $SCRATCH WITH (FORCE)" >/dev/null 2>&1 || true' EXIT
run_pg pg_restore -p "$DB_PORT" --exit-on-error --no-password -d "$SCRATCH" < "$dump"
seconds=$(( $(date +%s) - started ))

tables="SELECT count(*) FROM information_schema.tables WHERE table_schema IN ('core','billing','platform','ops','auth')"
migrations="SELECT string_agg(name || ':' || checksum, ',' ORDER BY name) FROM migration.history"
rows="SELECT (SELECT count(*) FROM core.organizations)||'/'||(SELECT count(*) FROM core.customers)||'/'||(SELECT count(*) FROM core.service_events)||'/'||(SELECT count(*) FROM billing.payments)||'/'||(SELECT count(*) FROM platform.audit_logs)"
fail=0
for check in "$tables" "$rows"; do
  live="$(q "$DB_NAME" "SET row_security = off; $check" | tail -1)"; restored="$(q "$SCRATCH" "SET row_security = off; $check" | tail -1)"
  if [ "$live" != "$restored" ]; then echo "MISMATCH: $check → live $live, restored $restored"; fail=1; fi
done
live_m="$(q "$DB_NAME" "$migrations" 2>/dev/null || true)"; restored_m="$(q "$SCRATCH" "$migrations" 2>/dev/null || true)"
[ "$live_m" = "$restored_m" ] || { echo "MISMATCH: migrations"; fail=1; }

echo "restore-check $(basename "$dump"): restored in ${seconds}s; tables $(q "$SCRATCH" "$tables"); rows org/customers/service/payments/audit $(q "$SCRATCH" "SET row_security = off; $rows" | tail -1)"
[ "$fail" = 0 ] && echo "RESTORE OK" || { echo "RESTORE CHECK FAILED"; exit 1; }
