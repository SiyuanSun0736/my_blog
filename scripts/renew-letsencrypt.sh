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

mkdir -p "$letsencrypt_dir" "$webroot_dir"

renew_args="renew --webroot -w /var/www/certbot"
if [ "$dry_run" = "1" ]; then
  renew_args="$renew_args --dry-run"
fi

echo "Running certbot renewal with webroot challenge." >&2
compose --profile certbot run --rm certbot $renew_args

echo "Renewal command finished. If certificates changed, blog-web will reload them automatically within ${BLOG_TLS_RELOAD_INTERVAL_SECONDS:-60} seconds." >&2
echo "Inspect reload logs with: docker logs wanderlust-web --since 10m" >&2