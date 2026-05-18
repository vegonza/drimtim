#!/bin/sh
set -e

CHECKSUM_FILE="/app/node_modules/.bun-lock-checksum"
CURRENT_CHECKSUM=$(md5sum /app/package.json 2>/dev/null | cut -d' ' -f1 || echo "none")

if [ ! -d "/app/node_modules" ] || [ ! -f "$CHECKSUM_FILE" ] || [ "$(cat $CHECKSUM_FILE 2>/dev/null)" != "$CURRENT_CHECKSUM" ]; then
  echo "Dependencies changed, running bun install..."
  bun install
  echo "$CURRENT_CHECKSUM" > "$CHECKSUM_FILE"
else
  echo "Dependencies up to date"
fi

exec "$@"
