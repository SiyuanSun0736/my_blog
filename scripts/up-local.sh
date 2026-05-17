#!/bin/sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
cd "$ROOT_DIR"

compose_env_file="${WANDERLUST_LOCAL_ENV_FILE:-$ROOT_DIR/.env}"

if [ ! -f "$compose_env_file" ]; then
  echo "Local compose env file not found: $compose_env_file" >&2
  exit 1
fi

set -a
. "$compose_env_file"
set +a

tls_mount_root=/etc/nginx/certs
tls_certs_dir=${BLOG_TLS_CERTS_DIR:-./certs}
tls_cert_path=${BLOG_TLS_CERT_PATH:-$tls_mount_root/fullchain.pem}
tls_key_path=${BLOG_TLS_KEY_PATH:-$tls_mount_root/privkey.pem}
primary_domain=${BLOG_PRIMARY_DOMAIN:-localhost}
www_domain=${BLOG_WWW_DOMAIN:-www.localhost}

resolve_host_path() {
  case "$1" in
    /*)
      printf '%s\n' "$1"
      ;;
    *)
      printf '%s\n' "$ROOT_DIR/${1#./}"
      ;;
  esac
}

resolve_mounted_cert_path() {
  case "$1" in
    "$tls_mount_root"/*)
      relative_path=${1#"$tls_mount_root"/}
      printf '%s\n' "$resolved_tls_certs_dir/$relative_path"
      ;;
    *)
      return 1
      ;;
  esac
}

is_local_domain() {
  case "$1" in
    localhost|127.0.0.1|*.localhost)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

ensure_local_certs() {
  resolved_tls_certs_dir=$(resolve_host_path "$tls_certs_dir")

  cert_host_path=$(resolve_mounted_cert_path "$tls_cert_path" || true)
  key_host_path=$(resolve_mounted_cert_path "$tls_key_path" || true)

  if [ -z "$cert_host_path" ]; then
    cert_host_path="$resolved_tls_certs_dir/fullchain.pem"
  fi

  if [ -z "$key_host_path" ]; then
    key_host_path="$resolved_tls_certs_dir/privkey.pem"
  fi

  if [ -f "$cert_host_path" ] && [ -f "$key_host_path" ]; then
    return 0
  fi

  if ! is_local_domain "$primary_domain" && ! is_local_domain "$www_domain"; then
    echo "Missing TLS certs and current domains are not local-only: $primary_domain / $www_domain" >&2
    echo "Please place cert files under $resolved_tls_certs_dir or point BLOG_TLS_CERTS_DIR to an existing certificate tree." >&2
    exit 1
  fi

  if ! command -v openssl >/dev/null 2>&1; then
    echo "openssl is required to generate local TLS certs automatically." >&2
    exit 1
  fi

  mkdir -p "$(dirname "$cert_host_path")" "$(dirname "$key_host_path")"

  openssl_config=$(mktemp)
  trap 'rm -f "$openssl_config"' EXIT HUP INT TERM

  cat > "$openssl_config" <<EOF
[req]
default_bits = 2048
prompt = no
default_md = sha256
x509_extensions = v3_req
distinguished_name = dn

[dn]
CN = ${primary_domain}

[v3_req]
subjectAltName = @alt_names

[alt_names]
DNS.1 = ${primary_domain}
DNS.2 = ${www_domain}
DNS.3 = localhost
IP.1 = 127.0.0.1
EOF

  echo "Generating self-signed local TLS certs in $resolved_tls_certs_dir" >&2
  openssl req -x509 -nodes -newkey rsa:2048 -days 365 \
    -keyout "$key_host_path" \
    -out "$cert_host_path" \
    -config "$openssl_config" >/dev/null 2>&1

  chmod 600 "$key_host_path"
  chmod 644 "$cert_host_path"

  rm -f "$openssl_config"
  trap - EXIT HUP INT TERM
}

ensure_local_certs

echo "Using local environment file: $compose_env_file" >&2
echo "Starting local stack with default Compose parallelism." >&2
docker compose --env-file "$compose_env_file" up -d --build mongodb redis blog-api blog-web