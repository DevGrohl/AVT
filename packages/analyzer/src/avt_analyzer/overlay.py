"""Analysis Overlay loading and application."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from avt_analyzer.schema import Certainty, ExecutionFlowGraph, GraphWarning


@dataclass(frozen=True)
class Overlay:
    path: Path
    edge_resolutions: dict[str, Certainty]
    warnings: tuple[GraphWarning, ...]


def load_overlay(path: Path) -> Overlay:
    """Load an Analysis Overlay file.

    Initial shape:

    ```json
    {
      "edge_resolutions": [
        {"edge_id": "edge:...", "certainty": "confirmed"},
        {"edge_id": "edge:...", "certainty": "rejected"}
      ]
    }
    ```
    """

    warnings: list[GraphWarning] = []
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        return Overlay(
            path=path,
            edge_resolutions={},
            warnings=(
                {
                    "code": "invalid_overlay_json",
                    "message": f"Could not parse Analysis Overlay {path}: {exc.msg}",
                    "location": {"path": str(path), "line": exc.lineno, "column": exc.colno},
                },
            ),
        )
    except OSError as exc:
        return Overlay(
            path=path,
            edge_resolutions={},
            warnings=({"code": "overlay_read_error", "message": f"Could not read Analysis Overlay {path}: {exc}"},),
        )

    if not isinstance(raw, dict):
        return Overlay(path=path, edge_resolutions={}, warnings=({"code": "invalid_overlay", "message": "Analysis Overlay must be a JSON object"},))

    resolutions: dict[str, Certainty] = {}
    entries = raw.get("edge_resolutions", [])
    if not isinstance(entries, list):
        warnings.append({"code": "invalid_overlay_edge_resolutions", "message": "Analysis Overlay edge_resolutions must be a list"})
        entries = []

    for index, entry in enumerate(entries):
        parsed = _parse_resolution(entry)
        if parsed is None:
            warnings.append({"code": "invalid_overlay_resolution", "message": f"Invalid edge resolution at index {index}"})
            continue
        edge_id, certainty = parsed
        resolutions[edge_id] = certainty

    return Overlay(path=path, edge_resolutions=resolutions, warnings=tuple(warnings))


def apply_overlay(graph: ExecutionFlowGraph, overlay: Overlay) -> None:
    """Apply overlay resolutions to graph edges in place."""

    graph["warnings"].extend(overlay.warnings)
    edge_by_id = {edge["id"]: edge for edge in graph["edges"]}
    for edge_id, certainty in overlay.edge_resolutions.items():
        edge = edge_by_id.get(edge_id)
        if edge is None:
            graph["warnings"].append({"code": "overlay_edge_not_found", "message": f"Overlay references missing edge: {edge_id}"})
            continue
        if edge["certainty"] != "uncertain":
            graph["warnings"].append({"code": "overlay_edge_not_uncertain", "message": f"Overlay resolution ignored for non-uncertain edge: {edge_id}"})
            continue
        edge["certainty"] = certainty
        edge["evidence"]["reason"] = {
            "code": "overlay_resolution",
            "label": f"Analysis Overlay marked edge as {certainty}",
        }


def _parse_resolution(entry: Any) -> tuple[str, Certainty] | None:
    if not isinstance(entry, dict):
        return None
    edge_id = entry.get("edge_id")
    certainty = entry.get("certainty")
    if not isinstance(edge_id, str) or certainty not in {"confirmed", "rejected"}:
        return None
    return edge_id, certainty
