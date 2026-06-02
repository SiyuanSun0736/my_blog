#!/bin/sh
set -eu

primary_domain="${BLOG_PRIMARY_DOMAIN:-wanderlust0736.top}"
www_domain="${BLOG_WWW_DOMAIN:-www.wanderlust0736.top}"

log() {
  printf '%s\n' "$*" >&2
}

resolve_ipv4s() {
  getent ahostsv4 "$1" 2>/dev/null | awk '{print $1}' | sort -u
}

is_public_ipv4() {
  ip="$1"

  printf '%s\n' "$ip" | awk -F. '
    NF != 4 { exit 1 }
    {
      for (i = 1; i <= 4; i++) {
        if ($i !~ /^[0-9]+$/ || $i < 0 || $i > 255) {
          exit 1
        }
      }
    }
    $1 == 0 || $1 == 10 || $1 == 127 { exit 1 }
    $1 == 100 && $2 >= 64 && $2 <= 127 { exit 1 }
    $1 == 169 && $2 == 254 { exit 1 }
    $1 == 172 && $2 >= 16 && $2 <= 31 { exit 1 }
    $1 == 192 && $2 == 168 { exit 1 }
    $1 == 198 && ($2 == 18 || $2 == 19) { exit 1 }
    $1 >= 224 { exit 1 }
    { exit 0 }
  '
}

check_domain() {
  domain="$1"
  resolved_ipv4s=$(resolve_ipv4s "$domain" || true)

  if [ -z "$resolved_ipv4s" ]; then
    log "DNS check failed: $domain has no A record."
    return 1
  fi

  public_ipv4s=""
  for ip in $resolved_ipv4s; do
    if is_public_ipv4 "$ip"; then
      public_ipv4s="$public_ipv4s $ip"
    fi
  done

  if [ -z "$public_ipv4s" ]; then
    log "DNS check failed: $domain resolves to non-public IPv4 addresses: $resolved_ipv4s"
    return 1
  fi

  log "DNS check passed: $domain ->$(printf ' %s' $public_ipv4s)"
  return 0
}

server_public_ip=$(curl -fsS -4 https://api.ipify.org 2>/dev/null || true)
if [ -n "$server_public_ip" ]; then
  log "Current server public IPv4: $server_public_ip"
fi

failed=0
check_domain "$primary_domain" || failed=1
check_domain "$www_domain" || failed=1

if [ "$failed" -ne 0 ]; then
  log "Let's Encrypt precheck failed. Fix DNS before running deploy-letsencrypt.sh."
  if [ -n "$server_public_ip" ]; then
    log "Suggested DNS: set A record for $primary_domain to $server_public_ip"
    log "Suggested DNS: set www as CNAME to $primary_domain, or A record to $server_public_ip"
  fi
  exit 1
fi
