#!/bin/sh
# Start a local HTTP server to run JSPlaskin in the browser.
# ES modules require HTTP – this can't be opened as file://.

PORT=${1:-8080}
DIR="$(cd "$(dirname "$0")" && pwd)"

echo "JSPlaskin — http://localhost:$PORT"
echo "Press Ctrl-C to stop."

# Try Python 3 first, then Python 2, then node http-server
if command -v python3 >/dev/null 2>&1; then
  cd "$DIR" && python3 -m http.server "$PORT"
elif command -v python >/dev/null 2>&1; then
  cd "$DIR" && python -m SimpleHTTPServer "$PORT"
elif command -v npx >/dev/null 2>&1; then
  npx http-server "$DIR" -p "$PORT" -c-1
else
  echo "Error: no suitable server found (need python3, python, or npx)."
  exit 1
fi
