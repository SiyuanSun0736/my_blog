#!/bin/sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
cd "$ROOT_DIR"

compose_env_file="${WANDERLUST_LOCAL_ENV_FILE:-$ROOT_DIR/.env}"

if [ ! -f "$compose_env_file" ]; then
  echo "Local compose env file not found: $compose_env_file" >&2
  exit 1
fi

echo "Using local environment file: $compose_env_file" >&2
echo "Starting local stack with default Compose parallelism." >&2
docker compose --env-file "$compose_env_file" up -d --build mongodb redis blog-api blog-web