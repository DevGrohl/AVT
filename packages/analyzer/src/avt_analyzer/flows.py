"""Static Execution Flow analysis."""

from __future__ import annotations

import ast
from dataclasses import dataclass

from avt_analyzer.entrypoints import DiscoveryResult, EntryPointCandidate, FunctionInfo, ModuleInfo
from avt_analyzer.schema import Certainty, EdgeKind, Evidence, FlowMarker, FlowMarkerKind, GraphEdge, SourceLocation


@dataclass(frozen=True)
class FlowEdge:
    edge: GraphEdge
    target: FunctionInfo


@dataclass(frozen=True)
class FlowAnalysisResult:
    edges: tuple[GraphEdge, ...]
    markers: tuple[FlowMarker, ...]
    flow_node_ids: dict[str, list[str]]
    flow_edge_ids: dict[str, list[str]]
    flow_marker_ids: dict[str, list[str]]


def analyze_flows(discovery: DiscoveryResult, *, max_depth: int) -> FlowAnalysisResult:
    """Follow local function calls from each discovered Entry Point."""

    context = _AnalysisContext(discovery)
    all_edges: dict[str, GraphEdge] = {}
    all_markers: dict[str, FlowMarker] = {}
    flow_node_ids: dict[str, list[str]] = {}
    flow_edge_ids: dict[str, list[str]] = {}
    flow_marker_ids: dict[str, list[str]] = {}

    for entry in discovery.entry_points:
        nodes: dict[str, None] = {entry.function.node_id: None}
        edges: dict[str, None] = {}
        markers: dict[str, None] = {}
        _walk_entry(
            context,
            entry,
            entry.function,
            max_depth=max_depth,
            depth=0,
            active=set(),
            nodes=nodes,
            edges=edges,
            markers=markers,
            all_edges=all_edges,
            all_markers=all_markers,
        )
        flow_node_ids[entry.id] = sorted(nodes)
        flow_edge_ids[entry.id] = sorted(edges)
        flow_marker_ids[entry.id] = sorted(markers)

    return FlowAnalysisResult(
        edges=tuple(edge for _, edge in sorted(all_edges.items())),
        markers=tuple(marker for _, marker in sorted(all_markers.items())),
        flow_node_ids=flow_node_ids,
        flow_edge_ids=flow_edge_ids,
        flow_marker_ids=flow_marker_ids,
    )


class _AnalysisContext:
    def __init__(self, discovery: DiscoveryResult) -> None:
        self.discovery = discovery
        self.module_by_path = {module.relative_path: module for module in discovery.modules}
        self.function_by_node_id = {fn.node_id: fn for fn in discovery.functions}
        self.functions_by_path = _functions_by_path(discovery.functions)
        self.functions_by_module_qualified_name = _functions_by_module_qualified_name(discovery.modules, discovery.functions)
        self.functions_by_name = _functions_by_name(discovery.functions)
        self.import_aliases_by_path = _import_aliases_by_path(discovery)


def _walk_entry(
    context: _AnalysisContext,
    entry: EntryPointCandidate,
    function: FunctionInfo,
    *,
    max_depth: int,
    depth: int,
    active: set[str],
    nodes: dict[str, None],
    edges: dict[str, None],
    markers: dict[str, None],
    all_edges: dict[str, GraphEdge],
    all_markers: dict[str, FlowMarker],
) -> None:
    if depth >= max_depth or function.node_id in active:
        return

    active.add(function.node_id)
    for marker in _markers_from_function(function):
        markers[marker["id"]] = None
        all_markers.setdefault(marker["id"], marker)

    for flow_edge in _calls_from_function(context, function):
        nodes[flow_edge.target.node_id] = None
        edges[flow_edge.edge["id"]] = None
        all_edges.setdefault(flow_edge.edge["id"], flow_edge.edge)
        if flow_edge.edge["certainty"] == "confirmed":
            _walk_entry(
                context,
                entry,
                flow_edge.target,
                max_depth=max_depth,
                depth=depth + 1,
                active=active,
                nodes=nodes,
                edges=edges,
                markers=markers,
                all_edges=all_edges,
                all_markers=all_markers,
            )
    active.remove(function.node_id)


def _markers_from_function(function: FunctionInfo) -> list[FlowMarker]:
    markers: list[FlowMarker] = []
    if isinstance(function.node, ast.AsyncFunctionDef):
        markers.append(_build_marker(function, "async", function.node, "async_function", "Function is async"))

    for node in ast.walk(function.node):
        if node is function.node:
            continue
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.Lambda)):
            continue
        if isinstance(node, (ast.If, ast.IfExp, ast.Match)):
            markers.append(_build_marker(function, "conditional", node, "conditional", "Function contains conditional flow"))
        elif isinstance(node, (ast.For, ast.AsyncFor, ast.While)):
            markers.append(_build_marker(function, "loop", node, "loop", "Function contains loop flow"))
        elif isinstance(node, ast.Raise):
            markers.append(_build_marker(function, "raise", node, "raise", "Function can raise"))
        elif isinstance(node, ast.Return):
            markers.append(_build_marker(function, "return", node, "return", "Function returns"))

    unique = {marker["id"]: marker for marker in markers}
    return [marker for _, marker in sorted(unique.items())]


def _build_marker(
    function: FunctionInfo,
    kind: FlowMarkerKind,
    node: ast.AST,
    reason_code: str,
    reason_label: str,
) -> FlowMarker:
    location = _source_location(function.relative_path, node)
    return {
        "id": f"marker:{kind}:{function.node_id}:{location['line']}:{location['column']}",
        "kind": kind,
        "node_id": function.node_id,
        "evidence": {"location": location, "reason": {"code": reason_code, "label": reason_label}},
    }


def _calls_from_function(context: _AnalysisContext, function: FunctionInfo) -> list[FlowEdge]:
    calls = _collect_calls(function.node)
    edges: list[FlowEdge] = []
    seen: set[str] = set()
    for call, is_await in calls:
        call_name = _dotted_name(call.func)
        if call_name is None:
            continue
        targets = _resolve_call(context, function, call_name)
        for target, certainty, reason_code, reason_label in targets:
            kind: EdgeKind = "await" if is_await else "call"
            edge = _build_edge(function, target, call, kind, certainty, reason_code, reason_label)
            if edge["id"] in seen:
                continue
            seen.add(edge["id"])
            edges.append(FlowEdge(edge=edge, target=target))
    return sorted(edges, key=lambda item: item.edge["id"])


def _resolve_call(
    context: _AnalysisContext,
    function: FunctionInfo,
    call_name: str,
) -> list[tuple[FunctionInfo, Certainty, str, str]]:
    same_file = context.functions_by_path.get(function.relative_path, ())
    module = context.module_by_path[function.relative_path]
    aliases = context.import_aliases_by_path.get(function.relative_path, {})

    if call_name.startswith("self.") and function.parent_qualified_name is not None:
        method_name = call_name.split(".", 1)[1]
        target = _find_qualified(same_file, f"{function.parent_qualified_name}.{method_name}")
        if target is not None:
            return [(target, "confirmed", "self_method_call", f"Resolved self.{method_name}() in current class")]

    if "." not in call_name:
        local_target = _find_qualified(same_file, call_name)
        if local_target is not None:
            return [(local_target, "confirmed", "same_module_call", f"Resolved local call {call_name}()")]

        imported = aliases.get(call_name)
        if imported is not None:
            target = context.functions_by_module_qualified_name.get(imported)
            if target is not None:
                return [(target, "confirmed", "imported_function_call", f"Resolved imported call {call_name}()")]

        name_matches = context.functions_by_name.get(call_name, ())
        if 1 < len(name_matches) <= 5:
            return [(target, "uncertain", "ambiguous_name_call", f"Ambiguous call {call_name}() could target this function") for target in name_matches]
        return []

    first, _, rest = call_name.partition(".")
    imported_prefix = aliases.get(first)
    if imported_prefix is not None:
        target = context.functions_by_module_qualified_name.get(f"{imported_prefix}.{rest}")
        if target is not None:
            return [(target, "confirmed", "imported_module_call", f"Resolved imported module call {call_name}()")]

    target = context.functions_by_module_qualified_name.get(f"{module.qualified_name}.{call_name}")
    if target is not None:
        return [(target, "confirmed", "same_module_qualified_call", f"Resolved qualified local call {call_name}()")]

    return []


def _collect_calls(node: ast.FunctionDef | ast.AsyncFunctionDef) -> list[tuple[ast.Call, bool]]:
    calls: list[tuple[ast.Call, bool]] = []

    class CallVisitor(ast.NodeVisitor):
        def __init__(self) -> None:
            self.await_depth = 0

        def visit_Await(self, node: ast.Await) -> None:  # noqa: N802 - ast visitor API
            self.await_depth += 1
            self.visit(node.value)
            self.await_depth -= 1

        def visit_Call(self, node: ast.Call) -> None:  # noqa: N802 - ast visitor API
            calls.append((node, self.await_depth > 0))
            self.generic_visit(node)

        def visit_FunctionDef(self, node: ast.FunctionDef) -> None:  # noqa: N802 - avoid nested function traversal
            if node is not node_to_visit:
                return
            self.generic_visit(node)

        def visit_AsyncFunctionDef(self, node: ast.AsyncFunctionDef) -> None:  # noqa: N802 - avoid nested function traversal
            if node is not node_to_visit:
                return
            self.generic_visit(node)

    node_to_visit = node
    CallVisitor().visit(node)
    return sorted(calls, key=lambda item: (item[0].lineno, item[0].col_offset, _dotted_name(item[0].func) or ""))


def _build_edge(
    source: FunctionInfo,
    target: FunctionInfo,
    call: ast.Call,
    kind: EdgeKind,
    certainty: Certainty,
    reason_code: str,
    reason_label: str,
) -> GraphEdge:
    return {
        "id": f"edge:{kind}:{certainty}:{source.node_id}->{target.node_id}:{call.lineno}:{call.col_offset}",
        "kind": kind,
        "source": source.node_id,
        "target": target.node_id,
        "certainty": certainty,
        "evidence": _evidence(source.relative_path, call, reason_code, reason_label),
    }


def _evidence(path: str, node: ast.AST, reason_code: str, reason_label: str) -> Evidence:
    return {
        "location": _source_location(path, node),
        "reason": {"code": reason_code, "label": reason_label},
    }


def _source_location(path: str, node: ast.AST) -> SourceLocation:
    location: SourceLocation = {
        "path": path,
        "line": getattr(node, "lineno", 1),
        "column": getattr(node, "col_offset", 0),
    }
    end_line = getattr(node, "end_lineno", None)
    end_column = getattr(node, "end_col_offset", None)
    if end_line is not None:
        location["end_line"] = end_line
    if end_column is not None:
        location["end_column"] = end_column
    return location


def _functions_by_path(functions: tuple[FunctionInfo, ...]) -> dict[str, tuple[FunctionInfo, ...]]:
    grouped: dict[str, list[FunctionInfo]] = {}
    for fn in functions:
        grouped.setdefault(fn.relative_path, []).append(fn)
    return {key: tuple(sorted(value, key=lambda fn: fn.qualified_name)) for key, value in grouped.items()}


def _functions_by_name(functions: tuple[FunctionInfo, ...]) -> dict[str, tuple[FunctionInfo, ...]]:
    grouped: dict[str, list[FunctionInfo]] = {}
    for fn in functions:
        grouped.setdefault(fn.name, []).append(fn)
    return {key: tuple(sorted(value, key=lambda fn: (fn.relative_path, fn.qualified_name))) for key, value in grouped.items()}


def _functions_by_module_qualified_name(modules: tuple[ModuleInfo, ...], functions: tuple[FunctionInfo, ...]) -> dict[str, FunctionInfo]:
    module_by_path = {module.relative_path: module for module in modules}
    return {f"{module_by_path[fn.relative_path].qualified_name}.{fn.qualified_name}": fn for fn in functions}


def _import_aliases_by_path(discovery: DiscoveryResult) -> dict[str, dict[str, str]]:
    aliases_by_path: dict[str, dict[str, str]] = {}
    for module in discovery.modules:
        aliases: dict[str, str] = {}
        for stmt in module.tree.body:
            if isinstance(stmt, ast.Import):
                for alias in stmt.names:
                    aliases[alias.asname or alias.name.split(".", 1)[0]] = alias.name
            elif isinstance(stmt, ast.ImportFrom) and stmt.module is not None:
                for alias in stmt.names:
                    imported_name = f"{stmt.module}.{alias.name}"
                    aliases[alias.asname or alias.name] = imported_name
        aliases_by_path[module.relative_path] = aliases
    return aliases_by_path


def _find_qualified(functions: tuple[FunctionInfo, ...], qualified_name: str) -> FunctionInfo | None:
    return next((fn for fn in functions if fn.qualified_name == qualified_name), None)


def _dotted_name(node: ast.AST) -> str | None:
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        parent = _dotted_name(node.value)
        return f"{parent}.{node.attr}" if parent else node.attr
    return None
