#!/bin/sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
cd "$ROOT_DIR"

primary_domain="${BLOG_PRIMARY_DOMAIN:-wanderlust0736.top}"
export COMPOSE_PARALLEL_LIMIT="${COMPOSE_PARALLEL_LIMIT:-1}"

echo "[1/6] Backing up MongoDB before update..." >&2
./scripts/backup-mongodb.sh

echo "[2/6] Pulling latest code..." >&2
git pull --ff-only

echo "[3/6] Building API image..." >&2
docker compose build blog-api

echo "[4/6] Building web image with low-memory frontend settings..." >&2
docker compose build blog-web

echo "[5/6] Restarting application containers without recreating MongoDB data..." >&2
docker compose up -d mongodb blog-api blog-web

echo "[6/6] Verifying container status and API response..." >&2
docker compose ps
curl -sk "https://127.0.0.1/api/posts" -H "Host: ${primary_domain}"