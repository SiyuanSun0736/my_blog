#!/bin/sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
cd "$ROOT_DIR"

compose_env_file="${WANDERLUST_COMPOSE_ENV_FILE:-$ROOT_DIR/.env}"

if [ -f "$compose_env_file" ]; then
  set -a
  . "$compose_env_file"
  set +a
fi

compose() {
  docker compose --env-file "$compose_env_file" "$@"
}

if [ "$#" -lt 1 ]; then
  echo "Usage: $0 <backup-dir-or-archive-file>" >&2
  exit 1
fi

input_path="$1"
database="${MONGODB_DATABASE:-wanderlust}"
drop_existing="${BLOG_BACKUP_RESTORE_DROP:-1}"
media_service="${BLOG_MEDIA_BACKUP_SERVICE:-blog-api}"
media_dir="${BLOG_MEDIA_DIR:-/app/media}"
restore_media="${BLOG_BACKUP_RESTORE_MEDIA:-1}"
input_is_dir=0
media_archive_file=""

if [ -d "$input_path" ]; then
  input_is_dir=1
  archive_file="$input_path/dump.archive.gz"
  if [ -f "$input_path/media.tar.gz" ]; then
    media_archive_file="$input_path/media.tar.gz"
  fi
else
  archive_file="$input_path"
fi

if [ ! -f "$archive_file" ]; then
  echo "Backup archive not found: $archive_file" >&2
  exit 1
fi

echo "Restoring MongoDB backup into database '$database'." >&2

if [ "$drop_existing" = "1" ]; then
  compose exec -T mongodb mongosh --quiet --eval "db.getSiblingDB('$database').dropDatabase()" >/dev/null
fi

compose exec -T mongodb mongorestore --archive --gzip < "$archive_file"

if [ "$restore_media" = "1" ] && [ -n "$media_archive_file" ]; then
  echo "Restoring media backup into '$media_dir' via service '$media_service'." >&2
  compose exec -T "$media_service" sh -eu -c 'mkdir -p "$1"; cd "$1"; rm -rf -- ./* ./.[!.]* ./..?*; tar -xzf - -C "$1"' sh "$media_dir" < "$media_archive_file"
elif [ "$restore_media" != "1" ]; then
  echo "Skipping media restore because BLOG_BACKUP_RESTORE_MEDIA=$restore_media." >&2
elif [ "$input_is_dir" = "1" ]; then
  echo "Media archive not found in backup directory; skipping media restore." >&2
fi

echo "Restore finished from: $archive_file" >&2
