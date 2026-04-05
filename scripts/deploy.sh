#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source ./.env
  set +a
fi

: "${DEPLOY_HOST:?DEPLOY_HOST is required in .env}"
: "${DEPLOY_USER:=root}"
: "${DEPLOY_APP_DIR:=/opt/kvartplata-watcher/app}"
: "${DEPLOY_SERVICE_NAME:=kvartplata-watcher}"
: "${DEPLOY_TMP_DIR:=/root}"
: "${DEPLOY_RUNTIME:=node}"

ARCHIVE_PATH="${TMPDIR:-/tmp}/kvartplata-watcher-deploy.tar.gz"
SERVER_ENV_PATH="${TMPDIR:-/tmp}/kvartplata-watcher.server.env"
REMOTE_ARCHIVE_PATH="$DEPLOY_TMP_DIR/kvartplata-watcher-deploy.tar.gz"
REMOTE_ENV_PATH="$DEPLOY_TMP_DIR/kvartplata-watcher.server.env"
REMOTE_SCRIPT_PATH="$DEPLOY_TMP_DIR/kvartplata-watcher-deploy.sh"

SSH_OPTS=(-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null)
[[ -n "${DEPLOY_SSH_PORT:-}" ]] && SSH_OPTS+=(-p "$DEPLOY_SSH_PORT")
[[ -n "${DEPLOY_SSH_KEY_PATH:-}" ]] && SSH_OPTS+=(-i "$DEPLOY_SSH_KEY_PATH")

if ! command -v tar >/dev/null 2>&1; then
  echo "tar is required" >&2
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required" >&2
  exit 1
fi

npm run build

COPYFILE_DISABLE=1 tar \
  --exclude='.git' \
  --exclude='node_modules' \
  --exclude='src' \
  --exclude='downloads' \
  --exclude='data/receipts' \
  -czf "$ARCHIVE_PATH" \
  dist prisma package.json package-lock.json data/storage-state.json README.md .env.example

cat > "$SERVER_ENV_PATH" <<ENV
TZ=${TZ:-America/Los_Angeles}
APP_URL=${APP_URL:-}
APP_TIMEZONE=${APP_TIMEZONE:-${TZ:-America/Los_Angeles}}
DATA_DIR=${DATA_DIR:-./data}
STORAGE_STATE_PATH=${STORAGE_STATE_PATH:-./data/storage-state.json}
DATABASE_URL=${DATABASE_URL:-}
DIRECT_URL=${DIRECT_URL:-}
HEADLESS=${HEADLESS:-true}
LOG_LEVEL=${LOG_LEVEL:-info}
LOGIN_URL=${LOGIN_URL:-}
LOGIN_REQUIRED_TEXT=${LOGIN_REQUIRED_TEXT:-}
ACCOUNT_READY_TEXT=${ACCOUNT_READY_TEXT:-}
SESSION_REQUIRED_KEYWORDS=${SESSION_REQUIRED_KEYWORDS:-}
ACCOUNT_PAGE_URL=${ACCOUNT_PAGE_URL:-}
CHARGES_PAGE_URL=${CHARGES_PAGE_URL:-}
CHARGES_TAB_SELECTOR=${CHARGES_TAB_SELECTOR:-}
ACCOUNT_CARD_SELECTOR=${ACCOUNT_CARD_SELECTOR:-}
ACCOUNT_NAME_SELECTOR=${ACCOUNT_NAME_SELECTOR:-}
ACCOUNT_ID_SELECTOR=${ACCOUNT_ID_SELECTOR:-}
ACCOUNT_LINK_SELECTOR=${ACCOUNT_LINK_SELECTOR:-}
ROW_SELECTOR=${ROW_SELECTOR:-}
MONTH_SELECTOR=${MONTH_SELECTOR:-}
AMOUNT_SELECTOR=${AMOUNT_SELECTOR:-}
STATUS_SELECTOR=${STATUS_SELECTOR:-}
RECEIPT_BUTTON_SELECTOR=${RECEIPT_BUTTON_SELECTOR:-}
NEXT_PAGE_SELECTOR=${NEXT_PAGE_SELECTOR:-}
WAIT_AFTER_LOGIN_MS=${WAIT_AFTER_LOGIN_MS:-3000}
WAIT_AFTER_NAV_MS=${WAIT_AFTER_NAV_MS:-1500}
DOWNLOAD_RECEIPTS=${DOWNLOAD_RECEIPTS:-false}
RECEIPT_DOWNLOAD_DIR=${RECEIPT_DOWNLOAD_DIR:-./data/receipts}
TELEGRAM_BOT_TOKEN=${TELEGRAM_BOT_TOKEN:-}
TELEGRAM_CHAT_ID=${TELEGRAM_CHAT_ID:-}
TELEGRAM_SILENT=${TELEGRAM_SILENT:-false}
SCHEDULE_ENABLED=${SCHEDULE_ENABLED:-false}
SCHEDULE_HOUR=${SCHEDULE_HOUR:-9}
SCHEDULE_MINUTE=${SCHEDULE_MINUTE:-0}
S3_PROVIDER=${S3_PROVIDER:-aws}
S3_ENABLED=${S3_ENABLED:-false}
S3_BUCKET=${S3_BUCKET:-}
S3_REGION=${S3_REGION:-}
S3_ACCESS_KEY_ID=${S3_ACCESS_KEY_ID:-}
S3_SECRET_ACCESS_KEY=${S3_SECRET_ACCESS_KEY:-}
S3_PREFIX=${S3_PREFIX:-}
S3_SIGNED_URL_TTL=${S3_SIGNED_URL_TTL:-3600}
PORT=${PORT:-3000}
NODE_ENV=production
ENV

cat > "$REMOTE_SCRIPT_PATH.local" <<'REMOTE'
set -euo pipefail
APP_DIR="${DEPLOY_APP_DIR}"
SERVICE_NAME="${DEPLOY_SERVICE_NAME}"
ARCHIVE_PATH="${REMOTE_ARCHIVE_PATH}"
ENV_PATH="${REMOTE_ENV_PATH}"
RUNTIME="${DEPLOY_RUNTIME}"

mkdir -p "$APP_DIR"
rm -rf "$APP_DIR"/*
tar -xzf "$ARCHIVE_PATH" -C "$APP_DIR"
cp "$ENV_PATH" "$APP_DIR/.env"
cd "$APP_DIR"

npm ci --omit=dev
npx prisma generate
npx prisma migrate deploy || npx prisma db push
npx playwright install chromium || true

cat > "/etc/systemd/system/${SERVICE_NAME}.service" <<UNIT
[Unit]
Description=${SERVICE_NAME}
After=network.target

[Service]
Type=simple
WorkingDirectory=${APP_DIR}
Environment=NODE_ENV=production
ExecStart=/usr/bin/${RUNTIME} ${APP_DIR}/dist/main.js
Restart=always
RestartSec=5
User=root

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable --now "$SERVICE_NAME"
systemctl restart "$SERVICE_NAME"
sleep 3
systemctl status --no-pager "$SERVICE_NAME" | sed -n '1,80p'
echo '---'
curl -sI "http://127.0.0.1:${PORT:-3000}/docs" || true
REMOTE

sed \
  -e "s#\${DEPLOY_APP_DIR}#${DEPLOY_APP_DIR//\/\\}#g" \
  -e "s#\${DEPLOY_SERVICE_NAME}#${DEPLOY_SERVICE_NAME//\/\\}#g" \
  -e "s#\${REMOTE_ARCHIVE_PATH}#${REMOTE_ARCHIVE_PATH//\/\\}#g" \
  -e "s#\${REMOTE_ENV_PATH}#${REMOTE_ENV_PATH//\/\\}#g" \
  -e "s#\${DEPLOY_RUNTIME}#${DEPLOY_RUNTIME//\/\\}#g" \
  "$REMOTE_SCRIPT_PATH.local" > "${REMOTE_SCRIPT_PATH}.rendered"

ssh_cmd() {
  local remote_cmd="$1"
  if [[ -n "${DEPLOY_SSH_PASSWORD:-}" ]]; then
    if command -v sshpass >/dev/null 2>&1; then
      sshpass -p "$DEPLOY_SSH_PASSWORD" ssh "${SSH_OPTS[@]}" "$DEPLOY_USER@$DEPLOY_HOST" "$remote_cmd"
    elif command -v expect >/dev/null 2>&1; then
      local opts=""
      local opt
      for opt in "${SSH_OPTS[@]}"; do
        opts+=" [list $opt]"
      done
      expect <<EXPECT
set timeout -1
spawn ssh {*}$opts ${DEPLOY_USER}@${DEPLOY_HOST} [list $remote_cmd]
expect {
  -re "(?i)password:" { send "${DEPLOY_SSH_PASSWORD}\\r"; exp_continue }
  eof
}
EXPECT
    else
      echo "Need sshpass or expect for password-based deploy" >&2
      exit 1
    fi
  else
    ssh "${SSH_OPTS[@]}" "$DEPLOY_USER@$DEPLOY_HOST" "$remote_cmd"
  fi
}

scp_cmd() {
  local from="$1"
  local to="$2"
  if [[ -n "${DEPLOY_SSH_PASSWORD:-}" ]]; then
    if command -v sshpass >/dev/null 2>&1; then
      sshpass -p "$DEPLOY_SSH_PASSWORD" scp "${SSH_OPTS[@]}" "$from" "$to"
    elif command -v expect >/dev/null 2>&1; then
      local opts=""
      local opt
      for opt in "${SSH_OPTS[@]}"; do
        opts+=" [list $opt]"
      done
      expect <<EXPECT
set timeout -1
spawn scp {*}$opts [list $from] [list $to]
expect {
  -re "(?i)password:" { send "${DEPLOY_SSH_PASSWORD}\\r"; exp_continue }
  eof
}
EXPECT
    else
      echo "Need sshpass or expect for password-based deploy" >&2
      exit 1
    fi
  else
    scp "${SSH_OPTS[@]}" "$from" "$to"
  fi
}

scp_cmd "$ARCHIVE_PATH" "$DEPLOY_USER@$DEPLOY_HOST:$REMOTE_ARCHIVE_PATH"
scp_cmd "$SERVER_ENV_PATH" "$DEPLOY_USER@$DEPLOY_HOST:$REMOTE_ENV_PATH"
scp_cmd "${REMOTE_SCRIPT_PATH}.rendered" "$DEPLOY_USER@$DEPLOY_HOST:$REMOTE_SCRIPT_PATH"
ssh_cmd "bash $REMOTE_SCRIPT_PATH"

echo "Deploy completed: ${DEPLOY_USER}@${DEPLOY_HOST}"
