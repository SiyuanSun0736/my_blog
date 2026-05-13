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
build_nice_level="${WANDERLUST_BUILD_NICE_LEVEL:-10}"
export COMPOSE_PARALLEL_LIMIT="${COMPOSE_PARALLEL_LIMIT:-1}"
export DOCKER_BUILDKIT="${DOCKER_BUILDKIT:-1}"
export WANDERLUST_COMPOSE_ENV_FILE="$compose_env_file"

compose() {
  docker compose --env-file "$compose_env_file" "$@"
}

compose_build() {
  service_name="$1"

  if command -v nice >/dev/null 2>&1 && [ "$build_nice_level" != "0" ]; then
    nice -n "$build_nice_level" docker compose --env-file "$compose_env_file" build "$service_name"
    return
  fi

  compose build "$service_name"
}

echo "[1/6] Backing up MongoDB before update..." >&2
./scripts/backup-mongodb.sh

echo "[2/7] Stopping running containers before deploy..." >&2
compose stop blog-web blog-api redis mongodb >/dev/null 2>&1 || true

echo "[3/7] Pulling latest code..." >&2
git pull --ff-only

echo "[4/7] Building API image with deploy low-memory settings..." >&2
compose_build blog-api

echo "[5/7] Building web image with deploy low-memory settings..." >&2
compose_build blog-web

echo "[6/7] Starting application containers with deploy environment..." >&2
compose up -d mongodb redis blog-api blog-web

echo "[7/7] Verifying container status and API response..." >&2
compose ps
curl -sk "https://127.0.0.1/api/posts" -H "Host: ${primary_domain}"