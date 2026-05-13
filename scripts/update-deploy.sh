#!/bin/sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
cd "$ROOT_DIR"

compose_env_file="${WANDERLUST_DEPLOY_ENV_FILE:-$ROOT_DIR/.env.deploy}"

if [ ! -f "$compose_env_file" ]; then
  echo "Deploy compose env file not found: $compose_env_file" >&2
  exit 1
fi

set -a
. "$compose_env_file"
set +a

primary_domain="${BLOG_PRIMARY_DOMAIN:-wanderlust0736.top}"
export COMPOSE_PARALLEL_LIMIT="${COMPOSE_PARALLEL_LIMIT:-1}"
export WANDERLUST_COMPOSE_ENV_FILE="$compose_env_file"

compose() {
  docker compose --env-file "$compose_env_file" "$@"
}

echo "[1/6] Backing up MongoDB before update..." >&2
./scripts/backup-mongodb.sh

echo "[2/6] Pulling latest code..." >&2
git pull --ff-only

echo "[3/6] Building API image with deploy low-memory settings..." >&2
compose build blog-api

echo "[4/6] Building web image with deploy low-memory settings..." >&2
compose build blog-web

echo "[5/6] Restarting application containers with deploy environment..." >&2
compose up -d mongodb redis blog-api blog-web

echo "[6/6] Verifying container status and API response..." >&2
compose ps
curl -sk "https://127.0.0.1/api/posts" -H "Host: ${primary_domain}"