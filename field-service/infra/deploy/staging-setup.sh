#!/usr/bin/env bash
# Staging on server2: creates the secrets file and the database roles once. Never prints secrets.
# Run as root:  STAGING_HOST=192.168.1.127 ./staging-setup.sh
#   - /etc/field-service/staging.env (root:ton07 0640), random secrets generated here
#   - roles fs_migrator / fs_api / fs_worker / fs_platform in cluster 16/staging (port 5434)
# Re-running keeps an existing env file and existing roles.
set -euo pipefail

ENV_FILE=/etc/field-service/staging.env
PG_PORT="${PG_PORT:-5434}"
APP_USER="${APP_USER:-ton07}"
HOST_IP="${STAGING_HOST:?set STAGING_HOST (address phones and browsers use, e.g. the LAN IP)}"
DATA=/data/field-service/staging
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

rand64() { openssl rand -base64 32 | tr -d '\n'; }
randhex() { openssl rand -hex 24; }

install -d -m 0750 -o root -g "$APP_USER" /etc/field-service
install -d -m 0750 -o "$APP_USER" -g "$APP_USER" "$DATA" "$DATA/media" "$DATA/backups"
install -d -m 0750 -o "$APP_USER" -g "$APP_USER" /data2/field-service

if [ ! -f "$ENV_FILE" ]; then
  umask 027
  M=$(randhex) A=$(randhex) W=$(randhex) P=$(randhex)
  cat > "$ENV_FILE" <<EOF
# field-service staging on server2 — generated $(date -I). Secrets: do not copy elsewhere.
# Internal staging: development mode (OTP codes in the API log) until a domain + DeeSMSx exist.
NODE_ENV=development
HOST=$HOST_IP
PORT=4100
MIGRATION_DB_PASSWORD=$M
API_DB_PASSWORD=$A
WORKER_DB_PASSWORD=$W
PLATFORM_DB_PASSWORD=$P
MIGRATION_DATABASE_URL=postgresql://fs_migrator:$M@127.0.0.1:$PG_PORT/field_service
DATABASE_URL=postgresql://fs_api:$A@127.0.0.1:$PG_PORT/field_service
WORKER_DATABASE_URL=postgresql://fs_worker:$W@127.0.0.1:$PG_PORT/field_service
PAYMENT_DATABASE_URL=postgresql://fs_worker:$W@127.0.0.1:$PG_PORT/field_service
SLIP_DATABASE_URL=postgresql://fs_worker:$W@127.0.0.1:$PG_PORT/field_service
PLATFORM_DATABASE_URL=postgresql://fs_platform:$P@127.0.0.1:$PG_PORT/field_service
OTP_SECRET=$(rand64)
JOIN_LINK_KEY=$(rand64)
MEDIA_URL_SECRET=$(rand64)
PLATFORM_SECRET_KEY=$(rand64)
MEDIA_DIR=$DATA/media
ERASURE_REGISTRY_FILE=/data2/field-service/erasure-registry.json
ADMIN_ORIGIN=http://$HOST_IP:3200
OWNER_WEB_URL=http://$HOST_IP:3200
JOIN_LINK_BASE_URL=http://$HOST_IP:3200/join
SMS_PROVIDER=development
OCR_PROVIDER=development
# OCR_PROVIDER=claude and ANTHROPIC_API_KEY=... when the key is provided.
EOF
  chown root:"$APP_USER" "$ENV_FILE"; chmod 0640 "$ENV_FILE"
  echo "created $ENV_FILE"
else
  echo "kept existing $ENV_FILE"
fi

set -a; . "$ENV_FILE"; set +a
if ! sudo -u postgres psql -p "$PG_PORT" -Atc "SELECT 1 FROM pg_roles WHERE rolname='fs_migrator'" | grep -q 1; then
  sudo -u postgres psql -p "$PG_PORT" -v ON_ERROR_STOP=1 -c "CREATE DATABASE field_service"
  sudo -u postgres env MIGRATION_DB_PASSWORD="$MIGRATION_DB_PASSWORD" API_DB_PASSWORD="$API_DB_PASSWORD" \
    WORKER_DB_PASSWORD="$WORKER_DB_PASSWORD" PLATFORM_DB_PASSWORD="$PLATFORM_DB_PASSWORD" \
    psql -p "$PG_PORT" -d field_service -q -f "$ROOT/infra/postgres/00-roles.sql"
  echo "roles created in cluster port $PG_PORT"
else
  echo "roles already exist"
fi
