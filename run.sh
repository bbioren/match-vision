#!/usr/bin/env bash
# MatchVision dev server — finds Node, validates data, starts server.
set -euo pipefail
cd "$(dirname "$0")"

# Prefer Homebrew Node, then system node, then Cursor helper.
if [ -x /opt/homebrew/bin/node ]; then
  NODE=/opt/homebrew/bin/node
elif command -v node >/dev/null 2>&1; then
  NODE=node
elif [ -x /Applications/Cursor.app/Contents/Resources/app/resources/helpers/node ]; then
  NODE=/Applications/Cursor.app/Contents/Resources/app/resources/helpers/node
else
  echo "Error: Node.js not found. Install with: brew install node"
  exit 1
fi

echo "Using Node: $("$NODE" -v) ($NODE)"
echo "Validating event logs..."
"$NODE" scripts/check-data.mjs
echo ""
PORT="${PORT:-5173}"
if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Error: port $PORT is already in use."
  echo "  Free it:  kill \$(lsof -t -iTCP:$PORT -sTCP:LISTEN)"
  echo "  Or use:   PORT=5180 ./run.sh"
  exit 1
fi
echo "Starting MatchVision at http://localhost:$PORT"
echo "  Main demo:     http://localhost:$PORT/"
echo "  Annotation:    http://localhost:$PORT/annotate.html"
echo "  Press Ctrl+C to stop."
echo ""
exec "$NODE" server.mjs
