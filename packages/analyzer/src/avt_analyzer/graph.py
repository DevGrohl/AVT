"""Execution Flow Graph construction helpers."""

from __future__ import annotations

from datetime import UTC, datetime

from avt_analyzer.schema import ExecutionFlowGraph

SCHEMA_VERSION = "0.1.0"


def build_empty_graph(*, project_name: str, analyzer_version: str, include_timestamp: bool = True) -> ExecutionFlowGraph:
    metadata = {
        "schema_version": SCHEMA_VERSION,
        "analyzer_version": analyzer_version,
        "project_name": project_name,
    }
    if include_timestamp:
        metadata["generated_at"] = datetime.now(UTC).isoformat()

    return {
        "metadata": metadata,
        "entry_points": [],
        "flows": [],
        "nodes": [],
        "edges": [],
        "markers": [],
        "warnings": [],
    }
