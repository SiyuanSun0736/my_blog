#!/bin/sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
cd "$ROOT_DIR"

compose_env_file="${WANDERLUST_DEPLOY_ENV_FILE:-$ROOT_DIR/.env.deploy}"
lock_dir="${WANDERLUST_CERTBOT_LOCK_DIR:-${TMPDIR:-/tmp}/wanderlust-certbot-renew.lock}"

log() {
  printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >&2
}

cleanup() {
  rmdir "$lock_dir" >/dev/null 2>&1 || true
}

if [ ! -f "$compose_env_file" ]; then
  log "Deploy compose env file not found: $compose_env_file"
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  log "docker command not found. Install Docker Engine and the Compose plugin first."
  exit 1
fi

if ! mkdir "$lock_dir" 2>/dev/null; then
  log "Another Let's Encrypt renewal run is already in progress: $lock_dir"
  exit 0
fi
trap cleanup EXIT HUP INT TERM

if ! docker compose version >/dev/null 2>&1; then
  log "docker compose plugin is unavailable."
  exit 1
fi

set -a
. "$compose_env_file"
set +a

primary_domain="${BLOG_PRIMARY_DOMAIN:-wanderlust0736.top}"
letsencrypt_dir="${BLOG_TLS_CERTS_DIR:-$ROOT_DIR/letsencrypt}"
webroot_dir="${BLOG_CERTBOT_WEBROOT_DIR:-$ROOT_DIR/certbot/www}"
cert_path="${BLOG_TLS_CERT_PATH:-/etc/nginx/certs/live/$primary_domain/fullchain.pem}"
key_path="${BLOG_TLS_KEY_PATH:-/etc/nginx/certs/live/$primary_domain/privkey.pem}"
dry_run="${CERTBOT_DRY_RUN:-0}"

export BLOG_PRIMARY_DOMAIN="${BLOG_PRIMARY_DOMAIN:-wanderlust0736.top}"
export BLOG_WWW_DOMAIN="${BLOG_WWW_DOMAIN:-www.wanderlust0736.top}"
export BLOG_TLS_CERTS_DIR="$letsencrypt_dir"
export BLOG_CERTBOT_WEBROOT_DIR="$webroot_dir"
export BLOG_TLS_CERT_PATH="$cert_path"
export BLOG_TLS_KEY_PATH="$key_path"
export WANDERLUST_COMPOSE_ENV_FILE="$compose_env_file"

compose() {
  docker compose --env-file "$compose_env_file" "$@"
}

if ! compose --profile certbot config --services | grep -qx 'certbot'; then
  log "Compose service 'certbot' is not defined."
  exit 1
fi

mkdir -p "$letsencrypt_dir" "$webroot_dir"

renew_args="renew --webroot -w /var/www/certbot"
if [ "$dry_run" = "1" ]; then
  renew_args="$renew_args --dry-run"
fi

if [ -z "$(compose ps --status running -q blog-web 2>/dev/null || true)" ]; then
  log "Warning: blog-web is not running. HTTP-01 webroot renewals require a web server to serve $webroot_dir on port 80."
fi

log "Running certbot renewal with webroot challenge."
compose --profile certbot run --rm certbot $renew_args

log "Renewal command finished. If certificates changed, blog-web will reload them automatically within ${BLOG_TLS_RELOAD_INTERVAL_SECONDS:-60} seconds."
log "Inspect reload logs with: docker logs wanderlust-web --since 10m"