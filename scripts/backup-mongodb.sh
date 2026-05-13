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
timestamp=$(date -u +%Y%m%dT%H%M%SZ)
output_dir="$backup_root/$database-$timestamp"
archive_file="$output_dir/dump.archive.gz"
metadata_file="$output_dir/metadata.txt"

mkdir -p "$output_dir"

echo "Creating MongoDB backup for database '$database'." >&2
compose exec -T mongodb mongodump --archive --gzip --db "$database" > "$archive_file"

cat > "$metadata_file" <<EOF
database=$database
created_at_utc=$timestamp
archive_file=$(basename "$archive_file")
EOF

if command -v sha256sum >/dev/null 2>&1; then
  sha256sum "$archive_file" > "$output_dir/dump.archive.gz.sha256"
fi

echo "Backup created at: $archive_file" >&2
