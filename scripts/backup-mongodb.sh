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

database="${MONGODB_DATABASE:-wanderlust}"
backup_root="${BLOG_BACKUP_DIR:-$ROOT_DIR/backups/mongodb}"
latest_backup_dir="${BLOG_LATEST_BACKUP_DIR:-$ROOT_DIR/backups/latest-mongodb}"
media_service="${BLOG_MEDIA_BACKUP_SERVICE:-blog-api}"
media_dir="${BLOG_MEDIA_DIR:-/app/media}"
timestamp=$(date -u +%Y%m%dT%H%M%SZ)
output_dir="$backup_root/$database-$timestamp"
archive_file="$output_dir/dump.archive.gz"
metadata_file="$output_dir/metadata.txt"
checksum_file="$output_dir/dump.archive.gz.sha256"
media_archive_file="$output_dir/media.tar.gz"
media_checksum_file="$output_dir/media.tar.gz.sha256"

write_checksum() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" > "$2"
  fi
}

sync_latest_backup() {
  mkdir -p "$latest_backup_dir"

  find "$latest_backup_dir" -mindepth 1 ! -name 'README.md' -exec rm -rf {} +

  cp "$archive_file" "$latest_backup_dir/dump.archive.gz"
  cp "$media_archive_file" "$latest_backup_dir/media.tar.gz"
  cp "$metadata_file" "$latest_backup_dir/metadata.txt"

  if [ -f "$checksum_file" ]; then
    cp "$checksum_file" "$latest_backup_dir/dump.archive.gz.sha256"
  fi

  if [ -f "$media_checksum_file" ]; then
    cp "$media_checksum_file" "$latest_backup_dir/media.tar.gz.sha256"
  fi
}

if [ "$latest_backup_dir" = "$backup_root" ]; then
  echo "BLOG_LATEST_BACKUP_DIR must differ from BLOG_BACKUP_DIR" >&2
  exit 1
fi

mkdir -p "$output_dir"

echo "Creating MongoDB backup for database '$database'." >&2
compose exec -T mongodb mongodump --archive --gzip --db "$database" > "$archive_file"

echo "Creating media backup from '$media_dir' via service '$media_service'." >&2
compose exec -T "$media_service" sh -eu -c 'mkdir -p "$1"; tar -C "$1" -czf - .' sh "$media_dir" > "$media_archive_file"

cat > "$metadata_file" <<EOF
database=$database
created_at_utc=$timestamp
archive_file=$(basename "$archive_file")
media_archive_file=$(basename "$media_archive_file")
media_source_dir=$media_dir
backup_dir=$(basename "$output_dir")
EOF

write_checksum "$archive_file" "$checksum_file"
write_checksum "$media_archive_file" "$media_checksum_file"

sync_latest_backup

echo "Backup created at: $archive_file" >&2
echo "Latest tracked backup synced to: $latest_backup_dir" >&2
