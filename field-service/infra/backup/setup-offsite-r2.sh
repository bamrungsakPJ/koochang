#!/usr/bin/env bash
# One-time setup of the encrypted off-site backup target on Cloudflare R2 (run as root on the
# backup host, interactively). Creates two rclone remotes in root's rclone config:
#   r2       S3 remote for the R2 bucket (access key typed here, never passed on the command line)
#   r2crypt  crypt remote over r2:<bucket>/<prefix>; backup.sh uses OFFSITE_RCLONE=r2crypt:
# The crypt passwords are generated here and printed ONCE. Store them in a password manager:
# without them the off-site copies cannot be decrypted if this server is lost.
#
#   sudo R2_ACCOUNT_ID=<account id> R2_BUCKET=koochang R2_PREFIX=staging ./setup-offsite-r2.sh
set -euo pipefail

[ "$(id -u)" = 0 ] || { echo "run as root (cron runs backup.sh as root)"; exit 1; }
command -v rclone >/dev/null || { echo "install rclone first: apt-get install -y rclone"; exit 1; }
: "${R2_ACCOUNT_ID:?set R2_ACCOUNT_ID (Cloudflare account id)}"
R2_BUCKET="${R2_BUCKET:-koochang}"
R2_PREFIX="${R2_PREFIX:-staging}"

if rclone listremotes | grep -qx 'r2crypt:'; then
  echo "r2crypt already configured; remove it with 'rclone config delete r2crypt' to start over"; exit 1
fi

read -r -p "R2 Access Key ID: " key_id
read -r -s -p "R2 Secret Access Key: " secret; echo
[ -n "$key_id" ] && [ -n "$secret" ] || { echo "both keys are required"; exit 1; }

# The secret goes through the environment, not argv, so it does not show in ps or shell history.
RCLONE_CONFIG_R2_TYPE=s3 RCLONE_CONFIG_R2_PROVIDER=Cloudflare \
RCLONE_CONFIG_R2_ACCESS_KEY_ID="$key_id" RCLONE_CONFIG_R2_SECRET_ACCESS_KEY="$secret" \
RCLONE_CONFIG_R2_ENDPOINT="https://$R2_ACCOUNT_ID.r2.cloudflarestorage.com" \
  rclone lsf "r2:$R2_BUCKET" >/dev/null || { echo "cannot reach bucket $R2_BUCKET: check keys, account id and bucket name"; exit 1; }

# From here on a failed step removes both remotes, so the script can simply be run again.
trap 'rc=$?; [ "$rc" = 0 ] || { rclone config delete r2crypt 2>/dev/null; rclone config delete r2 2>/dev/null; echo "setup failed; remotes removed, fix the cause and run again"; }' EXIT
# no_head: rclone 1.60 re-checks each upload with HEAD ?versionId=, which R2 answers 501 Not Implemented.
# Uploads are still verified: R2 checks the Content-MD5 that rclone sends with every PUT.
rclone config create r2 s3 provider Cloudflare access_key_id "$key_id" secret_access_key "$secret" \
  endpoint "https://$R2_ACCOUNT_ID.r2.cloudflarestorage.com" acl private no_check_bucket true no_head true >/dev/null
unset secret

pass1="$(openssl rand -base64 32)"; pass2="$(openssl rand -base64 32)"
rclone config create r2crypt crypt remote "r2:$R2_BUCKET/$R2_PREFIX" filename_encryption standard \
  directory_name_encryption true password "$pass1" password2 "$pass2" --obscure >/dev/null
chmod 600 "$(rclone config file | tail -1)"

# Round trip through the crypt remote, then confirm R2 itself only holds ciphertext names.
probe="setup-check-$(date -u +%Y%m%dT%H%M%SZ)"
echo "koochang off-site check" | rclone rcat "r2crypt:$probe"
[ "$(rclone cat "r2crypt:$probe")" = "koochang off-site check" ] || { echo "round trip failed"; exit 1; }
rclone lsf "r2:$R2_BUCKET/$R2_PREFIX" | grep -q "$probe" && { echo "names are not encrypted"; exit 1; }
rclone deletefile "r2crypt:$probe"

cat <<EOF

R2 off-site target ready: r2crypt: -> r2:$R2_BUCKET/$R2_PREFIX (encrypted, round trip OK)

SAVE THESE TWO VALUES IN A PASSWORD MANAGER NOW. They are needed to decrypt the
off-site backups on any other machine. They will not be shown again.
  crypt password : $pass1
  crypt password2: $pass2

Next: add OFFSITE_RCLONE=r2crypt: to the backup line in /etc/cron.d/field-service-staging
EOF
