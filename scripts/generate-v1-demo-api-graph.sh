#!/usr/bin/env bash
set -euo pipefail

TARGET="${AVT_DEMO_API_TARGET:-}"
OUT="${1:-/tmp/avt-demo-api-v1.json}"

if [[ -z "$TARGET" || ! -d "$TARGET" ]]; then
  echo "Generic hiring-process demo API target not found: ${TARGET:-<unset>}" >&2
  echo "Set AVT_DEMO_API_TARGET=/absolute/path/to/hiring-process-demo-api" >&2
  echo "This target is only a demo project used for realistic AVT validation." >&2
  exit 2
fi

uv run --project packages/analyzer avt analyze \
  "$TARGET" \
  --no-timestamp \
  --out "$OUT"

python -m json.tool "$OUT" >/dev/null

python - "$OUT" <<'PY'
from __future__ import annotations

import json
import sys
from pathlib import Path

path = Path(sys.argv[1])
graph = json.loads(path.read_text(encoding="utf-8"))
entry_points = graph.get("entry_points", [])
flows = graph.get("flows", [])
nodes = graph.get("nodes", [])
edges = graph.get("edges", [])
warnings = graph.get("warnings", [])

web_routes = [entry for entry in entry_points if entry.get("kind") == "web_route"]
framework_hooks = [entry for entry in entry_points if entry.get("kind") == "framework_hook"]
route_paths = {entry.get("route_path") for entry in web_routes}
edge_kinds = {edge.get("kind") for edge in edges}
external_labels = [node.get("label", "") for node in nodes if node.get("kind") == "external"]

checks = [
    (len(entry_points) >= 40, f"expected at least 40 Entry Points, found {len(entry_points)}"),
    (len(flows) >= 40, f"expected at least 40 flows, found {len(flows)}"),
    (len(web_routes) >= 40, f"expected at least 40 web routes, found {len(web_routes)}"),
    ("/api/users/token" in route_paths, "expected composed route /api/users/token"),
    ("/api/applications/toggle" in route_paths, "expected composed route /api/applications/toggle"),
    (bool(framework_hooks), "expected at least one framework hook"),
    ("external_interaction" in edge_kinds, "expected external interaction edges"),
    (any("database:" in label for label in external_labels), "expected database external interaction nodes"),
]

failures = [message for ok, message in checks if not ok]
if failures:
    print("V1 demo API graph regression failed:", file=sys.stderr)
    for failure in failures:
        print(f"- {failure}", file=sys.stderr)
    raise SystemExit(1)

print("V1 demo API graph regression passed")
print(f"Graph: {path}")
print(f"Entry Points: {len(entry_points)}")
print(f"Flows: {len(flows)}")
print(f"Nodes: {len(nodes)}")
print(f"Edges: {len(edges)}")
print(f"Warnings: {len(warnings)}")
print("Required routes: /api/users/token, /api/applications/toggle")
PY
