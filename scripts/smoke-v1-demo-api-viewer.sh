#!/usr/bin/env bash
set -euo pipefail

GRAPH="${1:-/tmp/avt-demo-api-v1.json}"

scripts/generate-v1-demo-api-graph.sh "$GRAPH"

(
  cd apps/viewer
  AVT_VIEWER_SMOKE_GRAPH="$GRAPH" \
  AVT_VIEWER_SMOKE_EXPECT_TEXT="#1|/api/users|Rank score" \
  npm run smoke
)
