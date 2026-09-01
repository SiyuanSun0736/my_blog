#!/bin/sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
cd "$ROOT_DIR"

remote_host="${WANDERLUST_DEPLOY_REMOTE:-blog-server}"
remote_dir="${WANDERLUST_DEPLOY_REMOTE_DIR:-/opt/my_blog}"
remote_env_file="${WANDERLUST_DEPLOY_REMOTE_ENV_FILE:-.env.deploy}"
skip_backup=0
show_logs=0

usage() {
  cat <<EOF
Usage: ./scripts/deploy-ghcr.sh [options]

Deploy the stack by pulling images from GHCR on the VPS.

Options:
  --remote HOST       SSH host for the VPS. Default: blog-server
  --remote-dir PATH   Repository path on the VPS. Default: /opt/my_blog
  --env-file PATH     Compose env file path on the VPS. Default: .env.deploy
  --skip-backup       Skip the database/media backup step on the VPS.
  --logs              Show recent blog-api/blog-web logs after verification.
  -h, --help          Show this help message.
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --remote)
      if [ "$#" -lt 2 ]; then
        echo "Missing value for --remote" >&2
        exit 1
      fi
      remote_host="$2"
      shift 2
      ;;
    --remote-dir)
      if [ "$#" -lt 2 ]; then
        echo "Missing value for --remote-dir" >&2
        exit 1
      fi
      remote_dir="$2"
      shift 2
      ;;
    --env-file)
      if [ "$#" -lt 2 ]; then
        echo "Missing value for --env-file" >&2
        exit 1
      fi
      remote_env_file="$2"
      shift 2
      ;;
    --skip-backup)
      skip_backup=1
      shift
      ;;
    --logs)
      show_logs=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Required command not found: $1" >&2
    exit 1
  fi
}

require_command ssh

remote_check() {
  ssh "$remote_host" sh -s -- "$remote_dir" "$remote_env_file" <<'REMOTE_CHECK'
set -eu
remote_dir="$1"
remote_env_file="$2"

cd "$remote_dir"
if [ ! -f "$remote_env_file" ]; then
  echo "Remote compose env file not found: $remote_dir/$remote_env_file" >&2
  exit 1
fi

docker compose version >/dev/null
REMOTE_CHECK
}

remote_backup() {
  ssh "$remote_host" sh -s -- "$remote_dir" "$remote_env_file" <<'REMOTE_BACKUP'
set -eu
remote_dir="$1"
remote_env_file="$2"

cd "$remote_dir"
export WANDERLUST_COMPOSE_ENV_FILE="$remote_env_file"
if [ -n "$(docker compose --env-file "$remote_env_file" ps --status running -q mongodb 2>/dev/null || true)" ]; then
  ./scripts/backup-mongodb.sh
else
  echo "Skipping backup because mongodb is not currently running." >&2
fi
REMOTE_BACKUP
}

remote_deploy() {
  ssh "$remote_host" sh -s -- "$remote_dir" "$remote_env_file" <<'REMOTE_DEPLOY'
set -eu
remote_dir="$1"
remote_env_file="$2"

cd "$remote_dir"
set -a
. "$remote_env_file"
set +a

if [ -n "${GHCR_USERNAME:-}" ] && [ -n "${GHCR_TOKEN:-}" ]; then
  printf '%s' "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USERNAME" --password-stdin
fi

docker compose --env-file "$remote_env_file" pull mongodb redis blog-api blog-web
docker compose --env-file "$remote_env_file" up -d --no-build --force-recreate mongodb redis blog-api blog-web
docker compose --env-file "$remote_env_file" ps
REMOTE_DEPLOY
}

remote_verify() {
  ssh "$remote_host" sh -s -- "$remote_dir" "$remote_env_file" <<'REMOTE_VERIFY'
set -eu
remote_dir="$1"
remote_env_file="$2"

cd "$remote_dir"
set -a
. "$remote_env_file"
set +a

primary_domain="${BLOG_PRIMARY_DOMAIN:-wanderlust0736.top}"
web_https_loopback_port="${WANDERLUST_WEB_HTTPS_LOOPBACK_PORT:-8444}"

curl -fsS -k \
  --resolve "${primary_domain}:${web_https_loopback_port}:127.0.0.1" \
  "https://${primary_domain}:${web_https_loopback_port}/api/posts" >/dev/null
echo "API check passed for ${primary_domain} via loopback :${web_https_loopback_port}." >&2
REMOTE_VERIFY
}

remote_cleanup() {
  ssh "$remote_host" sh -s -- "$remote_dir" <<'REMOTE_CLEAN'
set -eu
remote_dir="$1"

cd "$remote_dir"
find . -mindepth 1 -maxdepth 1 \
  ! -name '.env.deploy' \
  ! -name '.env.deploy.example' \
  ! -name 'docker-compose.yml' \
  ! -name 'scripts' \
  ! -name 'deploy' \
  ! -name 'letsencrypt' \
  ! -name 'certbot' \
  ! -name 'certs' \
  ! -name 'backups' \
  -exec rm -rf {} +
REMOTE_CLEAN
}

remote_logs() {
  ssh "$remote_host" sh -s -- "$remote_dir" "$remote_env_file" <<'REMOTE_LOGS'
set -eu
remote_dir="$1"
remote_env_file="$2"

cd "$remote_dir"
set -a
. "$remote_env_file"
set +a

docker compose --env-file "$remote_env_file" logs --since "${WANDERLUST_DEPLOY_LOG_SINCE:-10m}" blog-api blog-web
REMOTE_LOGS
}

remote_check

if [ "$skip_backup" -eq 0 ]; then
  remote_backup
fi

remote_deploy
remote_verify
remote_cleanup

if [ "$show_logs" -eq 1 ]; then
  remote_logs
fi

echo "GHCR deploy finished successfully." >&2
