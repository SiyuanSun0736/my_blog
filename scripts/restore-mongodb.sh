#!/bin/sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
cd "$ROOT_DIR"

if [ "$#" -lt 1 ]; then
  echo "Usage: $0 <backup-dir-or-archive-file>" >&2
  exit 1
fi

input_path="$1"
database="${MONGODB_DATABASE:-wanderlust}"
drop_existing="${BLOG_BACKUP_RESTORE_DROP:-1}"

if [ -d "$input_path" ]; then
  archive_file="$input_path/dump.archive.gz"
else
  archive_file="$input_path"
fi

if [ ! -f "$archive_file" ]; then
  echo "Backup archive not found: $archive_file" >&2
  exit 1
fi

echo "Restoring MongoDB backup into database '$database'." >&2

if [ "$drop_existing" = "1" ]; then
  docker compose exec -T mongodb mongosh --quiet --eval "db.getSiblingDB('$database').dropDatabase()" >/dev/null
fi

docker compose exec -T mongodb mongorestore --archive --gzip < "$archive_file"

echo "Restore finished from: $archive_file" >&2
