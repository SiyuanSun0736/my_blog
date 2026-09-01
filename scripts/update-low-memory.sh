#!/bin/sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
cd "$ROOT_DIR"

remote_host="${WANDERLUST_DEPLOY_REMOTE:-blog-server}"
remote_dir="${WANDERLUST_DEPLOY_REMOTE_DIR:-/opt/my_blog}"
remote_env_file="${WANDERLUST_DEPLOY_REMOTE_ENV_FILE:-.env.deploy}"
target_platform="${WANDERLUST_DEPLOY_PLATFORM:-linux/amd64}"
compose_project_name="${COMPOSE_PROJECT_NAME:-my_blog}"
frontend_build_heap_mb="${FRONTEND_BUILD_MAX_OLD_SPACE_SIZE:-2048}"
skip_backup=0
skip_pull=0
show_logs=0

usage() {
  cat <<EOF
Usage: ./scripts/update-low-memory.sh [options]

Build production Docker images locally, transfer them to the low-memory VPS,
load them there, and restart the deployed stack without building on the VPS.

Options:
  --remote HOST       SSH host for the VPS. Default: blog-server
  --remote-dir PATH   Repository path on the VPS. Default: /opt/my_blog
  --env-file PATH     Compose env file path on the VPS. Default: .env.deploy
  --platform VALUE    Docker target platform. Default: linux/amd64
  --frontend-heap MB  Local web build Node heap in MB. Default: 2048
  --skip-backup       Skip the database/media backup step on the VPS.
  --skip-pull         Skip git pull on the VPS before restart.
  --logs              Show recent blog-api/blog-web logs after verification.
  -h, --help          Show this help message.

Examples:
  ./scripts/update-low-memory.sh
  ./scripts/update-low-memory.sh --logs
  WANDERLUST_DEPLOY_REMOTE=root@216.23.120.223 ./scripts/update-low-memory.sh
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --remote)
      if [ "$#" -lt 2 ]; then
        echo "Missing value for --remote" >&2
        exit 1
      fi
      remote_host="$2"
      shift 2
      ;;
    --remote-dir)
      if [ "$#" -lt 2 ]; then
        echo "Missing value for --remote-dir" >&2
        exit 1
      fi
      remote_dir="$2"
      shift 2
      ;;
    --env-file)
      if [ "$#" -lt 2 ]; then
        echo "Missing value for --env-file" >&2
        exit 1
      fi
      remote_env_file="$2"
      shift 2
      ;;
    --platform)
      if [ "$#" -lt 2 ]; then
        echo "Missing value for --platform" >&2
        exit 1
      fi
      target_platform="$2"
      shift 2
      ;;
    --frontend-heap)
      if [ "$#" -lt 2 ]; then
        echo "Missing value for --frontend-heap" >&2
        exit 1
      fi
      frontend_build_heap_mb="$2"
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

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Required command not found: $1" >&2
    exit 1
  fi
}

announce_step() {
  current_step=$((current_step + 1))
  echo "[$current_step/$total_steps] $1" >&2
}

ensure_clean_tracked_worktree() {
  if ! git diff --quiet --ignore-submodules -- || ! git diff --cached --quiet --ignore-submodules --; then
    echo "Tracked git changes detected. Commit or stash them before image deployment." >&2
    exit 1
  fi
}

ensure_head_is_pushed() {
  branch=$(git branch --show-current)
  if [ -z "$branch" ]; then
    echo "Detached HEAD is not supported for image deployment." >&2
    exit 1
  fi

  upstream_ref=$(git rev-parse --abbrev-ref --symbolic-full-name '@{upstream}' 2>/dev/null || true)
  if [ -z "$upstream_ref" ]; then
    echo "Current branch has no upstream configured." >&2
    exit 1
  fi

  git fetch --quiet
  local_head=$(git rev-parse HEAD)
  upstream_head=$(git rev-parse "$upstream_ref")
  if [ "$local_head" != "$upstream_head" ]; then
    echo "Local HEAD is not equal to $upstream_ref. Push or pull before image deployment." >&2
    exit 1
  fi
}

cleanup() {
  if [ -n "${archive_dir:-}" ] && [ -d "$archive_dir" ]; then
    rm -rf "$archive_dir"
  fi
}

require_command git
require_command docker
require_command gzip
require_command scp
require_command ssh
require_command curl

if ! docker compose version >/dev/null 2>&1; then
  echo "docker compose is not available locally." >&2
  exit 1
fi

if ! docker buildx version >/dev/null 2>&1; then
  echo "docker buildx is not available locally. Install the Docker buildx CLI plugin first." >&2
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "Local Docker daemon is not available. Start Docker or Colima first." >&2
  exit 1
fi

total_steps=9
if [ "$skip_backup" -eq 1 ]; then
  total_steps=$((total_steps - 1))
fi
if [ "$skip_pull" -eq 1 ]; then
  total_steps=$((total_steps - 1))
fi
if [ "$show_logs" -eq 1 ]; then
  total_steps=$((total_steps + 1))
fi
current_step=0

archive_dir=$(mktemp -d "${TMPDIR:-/tmp}/wanderlust-image-deploy.XXXXXX")
trap cleanup EXIT HUP INT TERM

commit_sha=$(git rev-parse --short=12 HEAD)
archive_name="wanderlust-images-${commit_sha}.tar.gz"
archive_path="$archive_dir/$archive_name"
remote_archive="/tmp/$archive_name"

announce_step "Checking local git state..."
ensure_clean_tracked_worktree
ensure_head_is_pushed

announce_step "Checking remote deploy target..."
ssh "$remote_host" sh -s -- "$remote_dir" "$remote_env_file" "$skip_pull" <<'REMOTE_CHECK'
set -eu
remote_dir="$1"
remote_env_file="$2"
skip_pull="$3"

cd "$remote_dir"
if [ ! -f "$remote_env_file" ]; then
  echo "Remote compose env file not found: $remote_dir/$remote_env_file" >&2
  exit 1
fi

if [ "$skip_pull" -eq 0 ]; then
  if ! git diff --quiet --ignore-submodules -- || ! git diff --cached --quiet --ignore-submodules --; then
    echo "Remote tracked git changes detected. Commit or stash them first, or rerun with --skip-pull." >&2
    exit 1
  fi
fi

docker compose version >/dev/null
REMOTE_CHECK

announce_step "Building API image locally for $target_platform..."
COMPOSE_PROJECT_NAME="$compose_project_name" \
DOCKER_DEFAULT_PLATFORM="$target_platform" \
DOCKER_BUILDKIT="${DOCKER_BUILDKIT:-1}" \
docker compose build blog-api

announce_step "Building web image locally for $target_platform..."
COMPOSE_PROJECT_NAME="$compose_project_name" \
DOCKER_DEFAULT_PLATFORM="$target_platform" \
DOCKER_BUILDKIT="${DOCKER_BUILDKIT:-1}" \
FRONTEND_BUILD_MAX_OLD_SPACE_SIZE="$frontend_build_heap_mb" \
docker compose build blog-web

announce_step "Saving images to compressed archive..."
docker save \
  "${compose_project_name}-blog-api:latest" \
  "${compose_project_name}-blog-web:latest" \
  | gzip -c > "$archive_path"

announce_step "Uploading image archive to $remote_host..."
scp "$archive_path" "$remote_host:$remote_archive"

if [ "$skip_backup" -eq 0 ]; then
  announce_step "Backing up MongoDB on the VPS..."
  ssh "$remote_host" sh -s -- "$remote_dir" "$remote_env_file" <<'REMOTE_BACKUP'
set -eu
remote_dir="$1"
remote_env_file="$2"

cd "$remote_dir"
export WANDERLUST_COMPOSE_ENV_FILE="$remote_env_file"
if [ -n "$(docker compose --env-file "$remote_env_file" ps --status running -q mongodb 2>/dev/null || true)" ]; then
  ./scripts/backup-mongodb.sh
else
  echo "Skipping backup because mongodb is not currently running." >&2
fi
REMOTE_BACKUP
fi

if [ "$skip_pull" -eq 0 ]; then
  announce_step "Pulling latest code on the VPS..."
  ssh "$remote_host" sh -s -- "$remote_dir" <<'REMOTE_PULL'
set -eu
remote_dir="$1"

cd "$remote_dir"
GIT_TERMINAL_PROMPT=0 GIT_SSH_COMMAND="${GIT_SSH_COMMAND:-ssh -o BatchMode=yes}" git pull --ff-only
REMOTE_PULL
fi

announce_step "Loading images and restarting services on the VPS..."
ssh "$remote_host" sh -s -- "$remote_dir" "$remote_env_file" "$remote_archive" <<'REMOTE_DEPLOY'
set -eu
remote_dir="$1"
remote_env_file="$2"
remote_archive="$3"

cd "$remote_dir"
docker load -i "$remote_archive"
rm -f "$remote_archive"
docker compose --env-file "$remote_env_file" up -d --no-build --force-recreate mongodb redis blog-api blog-web
REMOTE_DEPLOY

announce_step "Verifying deployed services..."
ssh "$remote_host" sh -s -- "$remote_dir" "$remote_env_file" <<'REMOTE_VERIFY'
set -eu
remote_dir="$1"
remote_env_file="$2"

cd "$remote_dir"
set -a
. "$remote_env_file"
set +a

primary_domain="${BLOG_PRIMARY_DOMAIN:-wanderlust0736.top}"
web_https_loopback_port="${WANDERLUST_WEB_HTTPS_LOOPBACK_PORT:-8444}"

docker compose --env-file "$remote_env_file" ps
curl -fsS -k \
  --resolve "${primary_domain}:${web_https_loopback_port}:127.0.0.1" \
  "https://${primary_domain}:${web_https_loopback_port}/api/posts" >/dev/null
echo "API check passed for ${primary_domain} via loopback :${web_https_loopback_port}." >&2
REMOTE_VERIFY

if [ "$show_logs" -eq 1 ]; then
  announce_step "Showing recent application logs..."
  ssh "$remote_host" sh -s -- "$remote_dir" "$remote_env_file" <<'REMOTE_LOGS'
set -eu
remote_dir="$1"
remote_env_file="$2"

cd "$remote_dir"
set -a
. "$remote_env_file"
set +a

docker compose --env-file "$remote_env_file" logs --since "${WANDERLUST_DEPLOY_LOG_SINCE:-10m}" blog-api blog-web
REMOTE_LOGS
fi

echo "Image transfer deploy finished successfully." >&2
