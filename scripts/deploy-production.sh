#!/usr/bin/env bash
: <<'COMMENT'
Builds the backend for production from .env.production, prepares runtime
directories, verifies native OCR prerequisites, and reloads the Express app
through the repo-local PM2 ecosystem config.
COMMENT

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env.production}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing production env file: $ENV_FILE" >&2
  echo "Copy .env.production.example to .env.production and fill in real values." >&2
  exit 1
fi

if ! command -v pm2 >/dev/null 2>&1; then
  echo "pm2 is required on the production host but was not found in PATH." >&2
  exit 1
fi

cd "$ROOT_DIR"

set -a
source "$ENV_FILE"
set +a

mkdir -p logs
mkdir -p "$(dirname "${ADMIN_TOKEN_STORE_FILE:-data/admin-tokens.json}")"
mkdir -p "$(dirname "${ACCESS_USAGE_STORE_FILE:-data/access-usage.sqlite}")"

HUSKY=0 npm ci --omit=dev
npm run runtime:check
pm2 startOrReload ecosystem.config.cjs --env production --update-env
pm2 save

echo "softaware-apis deployed with PM2 as ${PM2_APP_NAME:-softaware-apis}"
