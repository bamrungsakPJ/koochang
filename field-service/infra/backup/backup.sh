#!/usr/bin/env bash
# Daily backup of the database and the private media directory (run on the database host, e.g.
# from cron as root: `sudo -u postgres` is used for pg_dump because forced RLS needs a role that
# can bypass it). Keeps 35 days, writes SHA-256 sums, optionally copies to an off-host target.
#
#   BACKUP_DIR=/var/backups/field-service DB_NAME=field_service MEDIA_DIR=/srv/field-service/media \
#   OFFSITE_TARGET=backup@nas:/backups/field-service ./backup.sh
#
# Nothing here prints secrets. Restore is proven with restore-check.sh before taking money.
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/field-service}"
DB_NAME="${DB_NAME:-field_service}"
DB_PORT="${DB_PORT:-5432}"
RETENTION_DAYS="${RETENTION_DAYS:-35}"
MEDIA_DIR="${MEDIA_DIR:-}"
OFFSITE_TARGET="${OFFSITE_TARGET:-}"
PG_AS="${PG_AS:-postgres}"

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
dump="$BACKUP_DIR/db-$stamp.dump"

run_pg() { if [ "$(id -un)" = "$PG_AS" ]; then "$@"; else sudo -n -u "$PG_AS" "$@"; fi; }

# Custom format: compressed, restorable table by table, includes roles' grants (not role passwords).
run_pg pg_dump -p "$DB_PORT" -Fc --no-password -d "$DB_NAME" > "$dump.partial"
mv "$dump.partial" "$dump"
files=("$(basename "$dump")")

if [ -n "$MEDIA_DIR" ] && [ -d "$MEDIA_DIR" ]; then
  media="$BACKUP_DIR/media-$stamp.tar.gz"
  tar -C "$MEDIA_DIR" -czf "$media.partial" .
  mv "$media.partial" "$media"
  files+=("$(basename "$media")")
fi

( cd "$BACKUP_DIR" && sha256sum "${files[@]}" > "sums-$stamp.sha256" )
chmod 600 "$BACKUP_DIR"/*-"$stamp".* 2>/dev/null || true

find "$BACKUP_DIR" -maxdepth 1 -type f \( -name 'db-*.dump' -o -name 'media-*.tar.gz' -o -name 'sums-*.sha256' \) -mtime "+$RETENTION_DAYS" -delete

if [ -n "$OFFSITE_TARGET" ]; then
  rsync -a --chmod=F600 "$BACKUP_DIR"/*-"$stamp".* "$OFFSITE_TARGET"/
fi

echo "backup $stamp: ${files[*]} ($(du -ch "${files[@]/#/$BACKUP_DIR/}" | tail -1 | cut -f1))"
