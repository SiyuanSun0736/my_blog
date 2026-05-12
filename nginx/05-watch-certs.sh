#!/bin/sh
set -eu

auto_reload="${TLS_AUTO_RELOAD:-1}"
reload_interval="${TLS_RELOAD_INTERVAL_SECONDS:-60}"

log() {
  printf '%s %s\n' "$(date -Iseconds)" "$*" >&2
}

case "$auto_reload" in
  0|false|FALSE|no|NO)
    log "TLS auto reload disabled"
    exit 0
    ;;
esac

case "$reload_interval" in
  ''|*[!0-9]*)
    log "Invalid TLS_RELOAD_INTERVAL_SECONDS: $reload_interval"
    exit 1
    ;;
esac

if [ "$reload_interval" -lt 5 ]; then
  reload_interval=5
fi

checksum_file() {
  sha256sum "$1" | awk '{print $1}'
}

watch_certs() {
  cert_checksum=$(checksum_file "$TLS_CERT_PATH")
  key_checksum=$(checksum_file "$TLS_KEY_PATH")

  log "Starting TLS watcher interval=${reload_interval}s cert=${TLS_CERT_PATH} key=${TLS_KEY_PATH}"
  log "Initial certificate fingerprints cert=${cert_checksum} key=${key_checksum}"

  while true; do
    sleep "$reload_interval"

    next_cert_checksum=$(checksum_file "$TLS_CERT_PATH")
    next_key_checksum=$(checksum_file "$TLS_KEY_PATH")

    if [ "$next_cert_checksum" != "$cert_checksum" ] || [ "$next_key_checksum" != "$key_checksum" ]; then
      cert_checksum="$next_cert_checksum"
      key_checksum="$next_key_checksum"

      log "TLS certificate change detected cert=${cert_checksum} key=${key_checksum}"
      if nginx -t >/dev/null 2>&1; then
        if nginx -s reload >/dev/null 2>&1; then
          log "Nginx reload completed successfully"
        else
          log "Nginx reload failed"
        fi
      else
        log "Nginx config test failed, skip reload"
      fi
    fi
  done
}

watch_certs &