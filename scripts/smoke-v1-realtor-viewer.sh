#!/usr/bin/env bash
set -euo pipefail

GRAPH="${1:-/tmp/avt-realtor-v1.json}"

scripts/generate-v1-realtor-graph.sh "$GRAPH"

(
  cd apps/viewer
  AVT_VIEWER_SMOKE_GRAPH="$GRAPH" \
  AVT_VIEWER_SMOKE_EXPECT_TEXT="RealtorCareersAPI|#1|/api/users|Rank score" \
  npm run smoke
)
