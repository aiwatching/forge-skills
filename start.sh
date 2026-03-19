#!/bin/bash
# Forge Skills Admin — start script
cd "$(dirname "$0")"

# Load .env
if [ -f .env ]; then
  export $(grep -v '^#' .env | xargs)
fi

# Kill old process on same port
PORT="${1:-3100}"
lsof -ti:"$PORT" | xargs kill -9 2>/dev/null

echo "Starting Forge Skills Admin on http://localhost:$PORT"
node admin.mjs --port "$PORT"
