#!/bin/sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
SERVICE_NAME="wanderlust-cert-renew.service"
TIMER_NAME="wanderlust-cert-renew.timer"
UNIT_DIR="${WANDERLUST_SYSTEMD_UNIT_DIR:-/etc/systemd/system}"
INSTALL_DRY_RUN="${WANDERLUST_SYSTEMD_DRY_RUN:-0}"
ENABLE_NOW="${WANDERLUST_SYSTEMD_ENABLE_NOW:-1}"
SHOW_STATUS="${WANDERLUST_SYSTEMD_SHOW_STATUS:-1}"
RUN_USER="${WANDERLUST_SYSTEMD_RUN_USER:-}"
CERTBOT_SERVICE_DRY_RUN="${CERTBOT_DRY_RUN:-0}"
TIMER_SOURCE="$ROOT_DIR/deploy/systemd/$TIMER_NAME"
RENEW_SCRIPT="$ROOT_DIR/scripts/renew-letsencrypt.sh"

log() {
  printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >&2
}

usage() {
  cat <<'EOF' >&2
Usage: ./scripts/install-cert-renew-timer.sh [--dry-run] [--user USER] [--unit-dir DIR] [--no-start] [--no-status]

Options:
  --dry-run       Render the unit files but do not install them.
  --user USER     Override the systemd service User= value.
  --unit-dir DIR  Override the systemd unit directory. Default: /etc/systemd/system.
  --no-start      Enable the timer but do not start it immediately.
  --no-status     Skip the final systemctl status output.
  -h, --help      Show this help message.

Environment overrides:
  WANDERLUST_SYSTEMD_RUN_USER
  WANDERLUST_SYSTEMD_UNIT_DIR
  WANDERLUST_SYSTEMD_DRY_RUN=1
  WANDERLUST_SYSTEMD_ENABLE_NOW=0
  WANDERLUST_SYSTEMD_SHOW_STATUS=0
  CERTBOT_DRY_RUN=1
EOF
}

run_as_root() {
  if [ "$(id -u)" -eq 0 ]; then
    "$@"
    return
  fi

  if ! command -v sudo >/dev/null 2>&1; then
    log "sudo command not found. Re-run as root or install sudo."
    exit 1
  fi

  sudo "$@"
}

detect_run_user() {
  if [ -n "$RUN_USER" ]; then
    return
  fi

  if [ -n "${SUDO_USER:-}" ] && [ "${SUDO_USER}" != "root" ]; then
    RUN_USER="$SUDO_USER"
    return
  fi

  RUN_USER=$(stat -c %U "$ROOT_DIR" 2>/dev/null || id -un)
}

render_service_unit() {
  cat <<EOF
[Unit]
Description=Renew Let's Encrypt certificate for Wanderlust
Wants=network-online.target docker.service
After=network-online.target docker.service

[Service]
Type=oneshot
User=$RUN_USER
WorkingDirectory=$ROOT_DIR
Environment=CERTBOT_DRY_RUN=$CERTBOT_SERVICE_DRY_RUN
ExecStart=/bin/sh $RENEW_SCRIPT

[Install]
WantedBy=multi-user.target
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --dry-run)
      INSTALL_DRY_RUN=1
      ;;
    --user)
      shift
      if [ "$#" -eq 0 ]; then
        usage
        exit 1
      fi
      RUN_USER="$1"
      ;;
    --unit-dir)
      shift
      if [ "$#" -eq 0 ]; then
        usage
        exit 1
      fi
      UNIT_DIR="$1"
      ;;
    --no-start)
      ENABLE_NOW=0
      ;;
    --no-status)
      SHOW_STATUS=0
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      usage
      exit 1
      ;;
  esac
  shift
done

if [ ! -f "$TIMER_SOURCE" ]; then
  log "Timer template not found: $TIMER_SOURCE"
  exit 1
fi

if [ ! -f "$RENEW_SCRIPT" ]; then
  log "Renewal script not found: $RENEW_SCRIPT"
  exit 1
fi

if ! command -v systemctl >/dev/null 2>&1; then
  log "systemctl command not found. This host does not look like a systemd system."
  exit 1
fi

detect_run_user

if ! id "$RUN_USER" >/dev/null 2>&1; then
  log "System user does not exist: $RUN_USER"
  exit 1
fi

tmp_dir=$(mktemp -d "${TMPDIR:-/tmp}/wanderlust-cert-renew.XXXXXX")
cleanup() {
  rm -rf "$tmp_dir"
}
trap cleanup EXIT HUP INT TERM

service_output="$tmp_dir/$SERVICE_NAME"
timer_output="$tmp_dir/$TIMER_NAME"

render_service_unit > "$service_output"
cp "$TIMER_SOURCE" "$timer_output"

if [ "$INSTALL_DRY_RUN" = "1" ]; then
  log "Dry run only. Rendered units for $RUN_USER in $ROOT_DIR."
  printf '%s\n' "--- $SERVICE_NAME ---"
  cat "$service_output"
  printf '\n%s\n' "--- $TIMER_NAME ---"
  cat "$timer_output"
  exit 0
fi

run_as_root install -d "$UNIT_DIR"
run_as_root install -m 0644 "$service_output" "$UNIT_DIR/$SERVICE_NAME"
run_as_root install -m 0644 "$timer_output" "$UNIT_DIR/$TIMER_NAME"
run_as_root systemctl daemon-reload

if [ "$ENABLE_NOW" = "1" ]; then
  run_as_root systemctl enable --now "$TIMER_NAME"
else
  run_as_root systemctl enable "$TIMER_NAME"
fi

if [ "$SHOW_STATUS" = "1" ]; then
  run_as_root systemctl status --no-pager "$TIMER_NAME" || true
fi

log "Installed $SERVICE_NAME and $TIMER_NAME for user $RUN_USER."