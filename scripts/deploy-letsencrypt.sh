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
www_domain="${BLOG_WWW_DOMAIN:-www.wanderlust0736.top}"
certbot_email="${CERTBOT_EMAIL:-}"
letsencrypt_dir="${BLOG_TLS_CERTS_DIR:-$ROOT_DIR/letsencrypt}"
webroot_dir="${BLOG_CERTBOT_WEBROOT_DIR:-$ROOT_DIR/certbot/www}"
cert_path="${BLOG_TLS_CERT_PATH:-/etc/nginx/certs/live/$primary_domain/fullchain.pem}"
key_path="${BLOG_TLS_KEY_PATH:-/etc/nginx/certs/live/$primary_domain/privkey.pem}"
compose_parallel_limit="${COMPOSE_PARALLEL_LIMIT:-1}"

export BLOG_PRIMARY_DOMAIN="$primary_domain"
export BLOG_WWW_DOMAIN="$www_domain"
export BLOG_TLS_CERTS_DIR="$letsencrypt_dir"
export BLOG_CERTBOT_WEBROOT_DIR="$webroot_dir"
export BLOG_TLS_CERT_PATH="$cert_path"
export BLOG_TLS_KEY_PATH="$key_path"
export COMPOSE_PARALLEL_LIMIT="$compose_parallel_limit"
export WANDERLUST_COMPOSE_ENV_FILE="$compose_env_file"

compose() {
  docker compose --env-file "$compose_env_file" "$@"
}

mkdir -p "$letsencrypt_dir" "$webroot_dir"

if [ ! -f "$letsencrypt_dir/live/$primary_domain/fullchain.pem" ] || [ ! -f "$letsencrypt_dir/live/$primary_domain/privkey.pem" ]; then
  if [ -z "$certbot_email" ]; then
    echo "CERTBOT_EMAIL is required for the first Let's Encrypt issuance." >&2
    exit 1
  fi

  sh "$ROOT_DIR/scripts/check-letsencrypt-dns.sh"

  echo "No existing Let's Encrypt certificate found. Requesting initial certificate for $primary_domain and $www_domain." >&2
  compose stop blog-web >/dev/null 2>&1 || true
  compose --profile certbot run --rm --service-ports certbot certonly \
    --standalone \
    --preferred-challenges http \
    --agree-tos \
    --no-eff-email \
    --email "$certbot_email" \
    --keep-until-expiring \
    -d "$primary_domain" \
    -d "$www_domain"
fi

echo "Building API image with low-memory settings." >&2
compose build blog-api

echo "Building web image with low-memory settings." >&2
compose build blog-web

compose up -d mongodb redis blog-api blog-web

echo "Deployment finished. blog-web will use certificates from $letsencrypt_dir." >&2
echo "Check container health with: docker compose --env-file $compose_env_file ps" >&2