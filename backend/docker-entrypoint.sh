#!/bin/sh
set -eu

mkdir -p /app/media
chown -R appuser:appuser /app/media

if [ "$#" -eq 0 ]; then
	set -- blog-api
fi

exec su-exec appuser "$@"