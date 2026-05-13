#!/bin/sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
cd "$ROOT_DIR/backend"

if [ "${BLOG_REPLACE_POSTS_CONFIRM:-0}" != "1" ]; then
	echo "Set BLOG_REPLACE_POSTS_CONFIRM=1 to replace existing posts with engineering-themed sample content." >&2
	exit 1
fi

go run ./cmd/seed-engineering-posts