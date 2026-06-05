"""Execution Flow Graph construction helpers."""

from __future__ import annotations

from datetime import UTC, datetime

from avt_analyzer.entrypoints import DiscoveryResult
from avt_analyzer.flows import analyze_flows
from avt_analyzer.schema import ExecutionFlowGraph, GraphNode

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


def build_discovery_graph(
    *,
    project_name: str,
    analyzer_version: str,
    discovery: DiscoveryResult,
    include_timestamp: bool = True,
    max_depth: int = 6,
) -> ExecutionFlowGraph:
    """Build a deterministic graph containing hierarchy nodes and Entry Points."""

    graph = build_empty_graph(
        project_name=project_name,
        analyzer_version=analyzer_version,
        include_timestamp=include_timestamp,
    )

    nodes: list[GraphNode] = []
    for module in discovery.modules:
        nodes.append(
            {
                "id": module.node_id,
                "kind": "module",
                "label": module.qualified_name,
                "path": module.relative_path,
                "qualified_name": module.qualified_name,
            }
        )

    class_node_ids: dict[tuple[str, str], str] = {}
    for cls in discovery.classes:
        node = {
            "id": cls.node_id,
            "kind": "class",
            "label": cls.name,
            "path": cls.relative_path,
            "qualified_name": cls.qualified_name,
            "parent_id": f"node:module:{cls.relative_path}",
        }
        if cls.parent_qualified_name is not None:
            node["parent_id"] = f"node:class:{cls.relative_path}:{cls.parent_qualified_name}"
        class_node_ids[(cls.relative_path, cls.qualified_name)] = cls.node_id
        nodes.append(node)

    for fn in discovery.functions:
        parent_id = f"node:module:{fn.relative_path}"
        if fn.parent_qualified_name is not None:
            parent_id = class_node_ids.get((fn.relative_path, fn.parent_qualified_name), parent_id)
        node = {
            "id": fn.node_id,
            "kind": fn.node_kind,
            "label": fn.name,
            "path": fn.relative_path,
            "qualified_name": fn.qualified_name,
            "signature": fn.signature,
            "parent_id": parent_id,
        }
        if fn.type_hints:
            node["type_hints"] = fn.type_hints
        nodes.append(node)

    graph["nodes"] = nodes
    flow_analysis = analyze_flows(discovery, max_depth=max_depth)

    graph["entry_points"] = [
        {
            "id": entry.id,
            "kind": entry.kind,
            "node_id": entry.function.node_id,
            "label": entry.label,
            "evidence": entry.evidence,
        }
        for entry in discovery.entry_points
    ]
    graph["edges"] = list(flow_analysis.edges)
    graph["markers"] = list(flow_analysis.markers)
    graph["flows"] = [
        {
            "id": f"flow:{entry.id}",
            "entry_point_id": entry.id,
            "node_ids": flow_analysis.flow_node_ids.get(entry.id, [entry.function.node_id]),
            "edge_ids": flow_analysis.flow_edge_ids.get(entry.id, []),
            "marker_ids": flow_analysis.flow_marker_ids.get(entry.id, []),
        }
        for entry in discovery.entry_points
    ]
    graph["warnings"] = list(discovery.warnings)
    return graph
