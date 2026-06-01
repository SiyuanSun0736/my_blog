#!/bin/sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
cd "$ROOT_DIR"

DEFAULT_ENV_FILE="$ROOT_DIR/.env.deploy"
compose_env_file="${WANDERLUST_DEPLOY_ENV_FILE:-$DEFAULT_ENV_FILE}"
skip_backup=0
skip_pull=0
force_sync=0
show_logs=0

usage() {
  cat <<EOF
Usage: ./scripts/update-deploy.sh [options]

Update the deployed stack with the low-memory VPS workflow.

Options:
  --env-file PATH   Use a specific compose env file.
  --skip-backup     Skip the database/media backup step.
  --skip-pull       Skip git pull and deploy the current local checkout.
  --force-sync      Reset the current branch to its upstream before build.
  --logs            Show recent blog-api/blog-web logs after verification.
  -h, --help        Show this help message.

Examples:
  ./scripts/update-deploy.sh
  ./scripts/update-deploy.sh --logs
  ./scripts/update-deploy.sh --skip-pull
  ./scripts/update-deploy.sh --force-sync
  ./scripts/update-deploy.sh --env-file /srv/wanderlust/.env.deploy --logs
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --env-file)
      if [ "$#" -lt 2 ]; then
        echo "Missing value for --env-file" >&2
        exit 1
      fi
      compose_env_file="$2"
      shift 2
      ;;
    --skip-backup)
      skip_backup=1
      shift
      ;;
    --skip-pull)
      skip_pull=1
      shift
      ;;
    --force-sync)
      force_sync=1
      shift
      ;;
    --logs)
      show_logs=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [ ! -f "$compose_env_file" ]; then
  echo "Deploy compose env file not found: $compose_env_file" >&2
  exit 1
fi

if [ "$skip_pull" -eq 1 ] && [ "$force_sync" -eq 1 ]; then
  echo "--force-sync cannot be used together with --skip-pull" >&2
  exit 1
fi

set -a
. "$compose_env_file"
set +a

primary_domain="${BLOG_PRIMARY_DOMAIN:-wanderlust0736.top}"
web_https_loopback_port="${WANDERLUST_WEB_HTTPS_LOOPBACK_PORT:-8444}"
build_nice_level="${WANDERLUST_BUILD_NICE_LEVEL:-10}"
log_since="${WANDERLUST_DEPLOY_LOG_SINCE:-10m}"
export COMPOSE_PARALLEL_LIMIT="${COMPOSE_PARALLEL_LIMIT:-1}"
export DOCKER_BUILDKIT="${DOCKER_BUILDKIT:-1}"
export WANDERLUST_COMPOSE_ENV_FILE="$compose_env_file"

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Required command not found: $1" >&2
    exit 1
  fi
}

compose() {
  docker compose --env-file "$compose_env_file" "$@"
}

service_container_id() {
  compose ps -q "$1" 2>/dev/null | head -n 1
}

service_running() {
  container_id=$(service_container_id "$1")
  if [ -z "$container_id" ]; then
    return 1
  fi

  [ "$(docker inspect -f '{{.State.Status}}' "$container_id" 2>/dev/null || true)" = "running" ]
}

backup_services_running() {
  backup_media_service="${BLOG_MEDIA_BACKUP_SERVICE:-blog-api}"

  service_running mongodb || return 1

  if [ "$backup_media_service" = "mongodb" ]; then
    return 0
  fi

  service_running "$backup_media_service"
}

ensure_compose_available() {
  if ! docker compose version >/dev/null 2>&1; then
    echo "docker compose is not available." >&2
    exit 1
  fi
}

ensure_clean_tracked_worktree() {
  if ! git diff --quiet --ignore-submodules -- || ! git diff --cached --quiet --ignore-submodules --; then
    echo "Tracked git changes detected. Commit or stash them first, or rerun with --skip-pull if you want to deploy the current checkout." >&2
    exit 1
  fi
}

pull_latest_code() {
  if [ "$force_sync" -eq 1 ]; then
    upstream_ref=$(git rev-parse --abbrev-ref --symbolic-full-name '@{upstream}' 2>/dev/null || true)
    if [ -z "$upstream_ref" ]; then
      echo "Current branch has no upstream configured; cannot use --force-sync." >&2
      return 1
    fi

    if [ -n "${GIT_SSH_COMMAND:-}" ]; then
      GIT_TERMINAL_PROMPT=0 git fetch --prune
    else
      GIT_TERMINAL_PROMPT=0 GIT_SSH_COMMAND="ssh -o BatchMode=yes" git fetch --prune
    fi

    git reset --hard "$upstream_ref"
    return
  fi

  if [ -n "${GIT_SSH_COMMAND:-}" ]; then
    GIT_TERMINAL_PROMPT=0 git pull --ff-only
    return
  fi

  GIT_TERMINAL_PROMPT=0 GIT_SSH_COMMAND="ssh -o BatchMode=yes" git pull --ff-only
}

compose_build() {
  service_name="$1"

  if command -v nice >/dev/null 2>&1 && [ "$build_nice_level" != "0" ]; then
    nice -n "$build_nice_level" docker compose --env-file "$compose_env_file" build "$service_name"
    return
  fi

  compose build "$service_name"
}

announce_step() {
  current_step=$((current_step + 1))
  echo "[$current_step/$total_steps] $1" >&2
}

total_steps=5

if [ "$skip_backup" -eq 0 ]; then
  total_steps=$((total_steps + 1))
fi

if [ "$skip_pull" -eq 0 ]; then
  total_steps=$((total_steps + 1))
fi

if [ "$show_logs" -eq 1 ]; then
  total_steps=$((total_steps + 1))
fi

current_step=0

require_command git
require_command docker
require_command curl
ensure_compose_available

if [ "$skip_pull" -eq 0 ]; then
  announce_step "Checking git worktree before pull..."
  ensure_clean_tracked_worktree
fi

if [ "$skip_backup" -eq 0 ]; then
  announce_step "Backing up MongoDB before update..."
  if backup_services_running; then
    ./scripts/backup-mongodb.sh
  else
    echo "Skipping backup because mongodb or ${BLOG_MEDIA_BACKUP_SERVICE:-blog-api} is not currently running. Start the stack first if you need a fresh backup before deploy." >&2
  fi
fi

announce_step "Stopping running containers before deploy..."
compose stop blog-web blog-api redis mongodb >/dev/null 2>&1 || true

if [ "$skip_pull" -eq 0 ]; then
  if [ "$force_sync" -eq 1 ]; then
    announce_step "Force-syncing current branch to upstream..."
  else
    announce_step "Pulling latest code..."
  fi
  if ! pull_latest_code; then
    echo "Git update failed without interactive prompts. Configure non-interactive access on the server, or rerun with --skip-pull after updating the checkout manually. If the remote branch was rebased, retry with --force-sync." >&2
    exit 1
  fi
fi

announce_step "Building API image with deploy low-memory settings..."
compose_build blog-api

announce_step "Building web image with deploy low-memory settings..."
compose_build blog-web

announce_step "Starting application containers with deploy environment..."
compose up -d mongodb redis blog-api blog-web

announce_step "Verifying container status and API response..."
compose ps
curl -fsS -k \
  --resolve "${primary_domain}:${web_https_loopback_port}:127.0.0.1" \
  "https://${primary_domain}:${web_https_loopback_port}/api/posts" >/dev/null
echo "API check passed for ${primary_domain} via loopback :${web_https_loopback_port}." >&2

if [ "$show_logs" -eq 1 ]; then
  announce_step "Showing recent application logs..."
  compose logs --since "$log_since" blog-api blog-web
fi

echo "Deploy update finished successfully." >&2