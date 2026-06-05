"""Execution Flow Graph schema helpers.

The schema starts as typed dictionaries so the JSON shape can evolve quickly
while remaining explicit and deterministic.
"""

from __future__ import annotations

from typing import Literal, NotRequired, TypedDict

Certainty = Literal["confirmed", "uncertain", "rejected"]
EntryPointKind = Literal["web_route", "cli_command", "script", "manual"]
NodeKind = Literal["project", "module", "class", "function", "method", "external"]
EdgeKind = Literal["call", "await", "external_interaction", "inheritance", "override"]
FlowMarkerKind = Literal["conditional", "raise", "return", "async", "loop"]


class SourceLocation(TypedDict):
    path: str
    line: int
    column: int
    end_line: NotRequired[int]
    end_column: NotRequired[int]


class DetectionReason(TypedDict):
    code: str
    label: str


class Evidence(TypedDict):
    location: SourceLocation
    reason: DetectionReason


class GraphMetadata(TypedDict):
    schema_version: str
    analyzer_version: str
    generated_at: NotRequired[str]
    project_name: str


class GraphNode(TypedDict):
    id: str
    kind: NodeKind
    label: str
    path: NotRequired[str]
    qualified_name: NotRequired[str]
    signature: NotRequired[str]
    type_hints: NotRequired[dict[str, str]]
    parent_id: NotRequired[str]


class GraphEdge(TypedDict):
    id: str
    kind: EdgeKind
    source: str
    target: str
    certainty: Certainty
    evidence: Evidence


class EntryPoint(TypedDict):
    id: str
    kind: EntryPointKind
    node_id: str
    label: str
    evidence: Evidence
    route_path: NotRequired[str]
    http_methods: NotRequired[list[str]]


class FlowMarker(TypedDict):
    id: str
    kind: FlowMarkerKind
    node_id: NotRequired[str]
    edge_id: NotRequired[str]
    evidence: Evidence


class ExecutionFlow(TypedDict):
    id: str
    entry_point_id: str
    node_ids: list[str]
    edge_ids: list[str]
    marker_ids: list[str]


class GraphWarning(TypedDict):
    code: str
    message: str
    location: NotRequired[SourceLocation]


class ExecutionFlowGraph(TypedDict):
    metadata: GraphMetadata
    entry_points: list[EntryPoint]
    flows: list[ExecutionFlow]
    nodes: list[GraphNode]
    edges: list[GraphEdge]
    markers: list[FlowMarker]
    warnings: list[GraphWarning]
