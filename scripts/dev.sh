#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

# Build ExtendScript
echo "Building ExtendScript bundle..."
node packages/extendscript/build.js

# Start dev server
echo "Starting Mayday dev server..."
exec npx tsx packages/server/src/index.ts
