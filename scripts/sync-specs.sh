#!/usr/bin/env bash
set -euo pipefail

REPO_URL="https://github.com/GoHighLevel/highlevel-api-docs.git"
CLONE_DIR="${TMPDIR:-/tmp}/highlevel-api-docs"
SPEC_DIR="$(cd "$(dirname "$0")/.." && pwd)/spec"

echo "==> Syncing GHL OpenAPI specs"
echo "    Source : $REPO_URL"
echo "    Cache  : $CLONE_DIR"
echo "    Target : $SPEC_DIR"

if [[ -d "$CLONE_DIR/.git" ]]; then
  echo "==> Pulling latest (already cloned)..."
  git -C "$CLONE_DIR" pull --ff-only --quiet
else
  echo "==> Shallow-cloning (first run)..."
  git clone --depth 1 --quiet "$REPO_URL" "$CLONE_DIR"
fi

echo "==> Copying specs..."

mkdir -p "$SPEC_DIR"

# Copy app specs
COPIED=0
for f in "$CLONE_DIR"/apps/*.json; do
  [[ -f "$f" ]] || continue
  cp "$f" "$SPEC_DIR/"
  COPIED=$((COPIED + 1))
done

# Copy common schemas (renamed with _ prefix to mark as internal)
COMMON_SRC="$CLONE_DIR/common/common-schemas.json"
if [[ -f "$COMMON_SRC" ]]; then
  cp "$COMMON_SRC" "$SPEC_DIR/_common-schemas.json"
  echo "    Copied _common-schemas.json"
fi

TOTAL_SIZE=$(du -sh "$SPEC_DIR" 2>/dev/null | cut -f1)
echo ""
echo "==> Done."
echo "    Spec files copied : $COPIED"
echo "    Total spec dir    : $TOTAL_SIZE"
