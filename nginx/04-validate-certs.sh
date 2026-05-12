#!/bin/sh
set -eu

: "${PRIMARY_DOMAIN:?PRIMARY_DOMAIN is required}"
: "${WWW_DOMAIN:?WWW_DOMAIN is required}"
: "${TLS_CERT_PATH:?TLS_CERT_PATH is required}"
: "${TLS_KEY_PATH:?TLS_KEY_PATH is required}"

if [ ! -f "$TLS_CERT_PATH" ]; then
  echo "Missing TLS certificate file: $TLS_CERT_PATH" >&2
  echo "Mount your cloud certificate or Let's Encrypt certificate tree before starting blog-web." >&2
  exit 1
fi

if [ ! -f "$TLS_KEY_PATH" ]; then
  echo "Missing TLS private key file: $TLS_KEY_PATH" >&2
  echo "Mount your cloud certificate or Let's Encrypt private key before starting blog-web." >&2
  exit 1
fi