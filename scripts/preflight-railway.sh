#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

MIGRATION="${1:-0046_ai_chef_cost_safety}"
TMP_FILE="$(mktemp -t kindcipe-preflight.XXXXXX.mjs)"
trap 'rm -f "$TMP_FILE"' EXIT

# Compile the TypeScript source locally; run the JS inside the Railway
# production container so DATABASE_URL is the canonical Railway Postgres URL.
npx esbuild scripts/preflight.ts \
  --bundle \
  --platform=node \
  --format=esm \
  --packages=external \
  --outfile="$TMP_FILE" >/dev/null

railway ssh -s kindcipe-backend -e production -- sh -c 'cat > /app/preflight.tmp.mjs' < "$TMP_FILE"
set +e
railway ssh -s kindcipe-backend -e production -- node /app/preflight.tmp.mjs --migration "$MIGRATION"
CODE=$?
set -e
railway ssh -s kindcipe-backend -e production -- sh -c 'rm -f /app/preflight.tmp.mjs' >/dev/null 2>&1 || true
exit "$CODE"
