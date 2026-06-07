"""Static Execution Flow analysis."""

from __future__ import annotations

import ast
from dataclasses import dataclass

from avt_analyzer.entrypoints import ClassInfo, DiscoveryResult, EntryPointCandidate, FunctionInfo, ModuleInfo
from avt_analyzer.schema import Certainty, EdgeKind, Evidence, FlowMarker, FlowMarkerKind, GraphEdge, GraphNode, SourceLocation


@dataclass(frozen=True)
class FlowEdge:
    edge: GraphEdge
    target: FunctionInfo | None


@dataclass(frozen=True)
class FlowAnalysisResult:
    edges: tuple[GraphEdge, ...]
    external_nodes: tuple[GraphNode, ...]
    markers: tuple[FlowMarker, ...]
    flow_node_ids: dict[str, list[str]]
    flow_edge_ids: dict[str, list[str]]
    flow_marker_ids: dict[str, list[str]]


def analyze_flows(discovery: DiscoveryResult, *, max_depth: int) -> FlowAnalysisResult:
    """Follow local function calls from each discovered Entry Point."""

    context = _AnalysisContext(discovery)
    all_edges: dict[str, GraphEdge] = {}
    all_markers: dict[str, FlowMarker] = {}
    all_external_nodes: dict[str, GraphNode] = {}
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
            all_external_nodes=all_external_nodes,
        )
        flow_node_ids[entry.id] = sorted(nodes)
        flow_edge_ids[entry.id] = sorted(edges)
        flow_marker_ids[entry.id] = sorted(markers)

    return FlowAnalysisResult(
        edges=tuple(edge for _, edge in sorted(all_edges.items())),
        external_nodes=tuple(node for _, node in sorted(all_external_nodes.items())),
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
        self.classes_by_name = _classes_by_name(discovery.classes)
        self.classes_by_module_qualified_name = _classes_by_module_qualified_name(discovery.modules, discovery.classes)
        self.import_aliases_by_path = _import_aliases_by_path(discovery)
        self.fastapi_dependency_aliases_by_path = _fastapi_dependency_aliases_by_path(self)
        self.argparse_dispatch_targets = _argparse_dispatch_targets(self)


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
    all_external_nodes: dict[str, GraphNode],
) -> None:
    if depth >= max_depth or function.node_id in active:
        return

    active.add(function.node_id)
    for marker in _markers_from_function(function):
        markers[marker["id"]] = None
        all_markers.setdefault(marker["id"], marker)

    for flow_edge in _calls_from_function(context, function):
        nodes[flow_edge.edge["target"]] = None
        edges[flow_edge.edge["id"]] = None
        all_edges.setdefault(flow_edge.edge["id"], flow_edge.edge)
        if flow_edge.target is None:
            all_external_nodes.setdefault(flow_edge.edge["target"], _external_node_from_id(flow_edge.edge["target"]))
            continue
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
                all_external_nodes=all_external_nodes,
            )
    active.remove(function.node_id)


def _markers_from_function(function: FunctionInfo) -> list[FlowMarker]:
    markers: list[FlowMarker] = []
    parent_map = _parent_map(function.node)
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
            trigger = _nearest_trigger_condition(node, parent_map)
            label = f"Function can raise when {trigger['expression']}" if trigger else "Function can raise"
            markers.append(_build_marker(function, "raise", node, "raise", label, trigger_condition=trigger))
        elif isinstance(node, ast.Return):
            trigger = _nearest_trigger_condition(node, parent_map)
            label = f"Function returns when {trigger['expression']}" if trigger else "Function returns"
            markers.append(_build_marker(function, "return", node, "return", label, trigger_condition=trigger))

    unique = {marker["id"]: marker for marker in markers}
    return [marker for _, marker in sorted(unique.items())]


def _build_marker(
    function: FunctionInfo,
    kind: FlowMarkerKind,
    node: ast.AST,
    reason_code: str,
    reason_label: str,
    trigger_condition: dict[str, str] | None = None,
) -> FlowMarker:
    location = _source_location(function.relative_path, node)
    marker: FlowMarker = {
        "id": f"marker:{kind}:{function.node_id}:{location['line']}:{location['column']}",
        "kind": kind,
        "node_id": function.node_id,
        "evidence": {"location": location, "reason": {"code": reason_code, "label": reason_label}},
    }
    if trigger_condition is not None:
        marker["trigger_condition"] = trigger_condition  # type: ignore[typeddict-item]
    return marker


def _parent_map(root: ast.AST) -> dict[ast.AST, ast.AST]:
    parents: dict[ast.AST, ast.AST] = {}
    for parent in ast.walk(root):
        for child in ast.iter_child_nodes(parent):
            parents[child] = parent
    return parents


def _nearest_trigger_condition(node: ast.AST, parents: dict[ast.AST, ast.AST]) -> dict[str, str] | None:
    child = node
    parent = parents.get(child)
    while parent is not None:
        if isinstance(parent, ast.If):
            expression = _safe_condition_expression(parent.test)
            if not expression:
                return None
            if child in parent.body:
                return {"expression": expression, "source": "if", "certainty": "confirmed"}
            if child in parent.orelse:
                if isinstance(child, ast.If):
                    elif_expression = _safe_condition_expression(child.test)
                    if elif_expression:
                        return {"expression": elif_expression, "source": "if", "certainty": "confirmed"}
                return {"expression": f"not ({expression})", "source": "else", "certainty": "confirmed"}
        if isinstance(parent, ast.ExceptHandler):
            exception_name = _safe_condition_expression(parent.type) if parent.type is not None else "exception"
            return {"expression": f"except {exception_name}", "source": "except", "certainty": "confirmed"}
        if isinstance(parent, (ast.For, ast.AsyncFor, ast.While)):
            if isinstance(parent, ast.While):
                expression = _safe_condition_expression(parent.test)
            else:
                expression = "loop iteration"
            if expression:
                return {"expression": expression, "source": "loop", "certainty": "uncertain"}
        child = parent
        parent = parents.get(parent)
    return None


def _safe_condition_expression(node: ast.AST | None) -> str | None:
    if node is None:
        return None
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        value = _safe_condition_expression(node.value)
        return f"{value}.{node.attr}" if value else node.attr
    if isinstance(node, ast.Constant):
        if node.value is None or isinstance(node.value, bool):
            return repr(node.value)
        if isinstance(node.value, int) and -999 <= node.value <= 999:
            return str(node.value)
        if isinstance(node.value, str):
            return "<string>"
        return "<literal>"
    if isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.Not):
        operand = _safe_condition_expression(node.operand)
        return f"not {operand}" if operand else None
    if isinstance(node, ast.BoolOp):
        op = " and " if isinstance(node.op, ast.And) else " or "
        parts = [_safe_condition_expression(value) for value in node.values]
        clean = [part for part in parts if part]
        return op.join(clean) if clean else None
    if isinstance(node, ast.Compare):
        left = _safe_condition_expression(node.left)
        if not left:
            return None
        pieces = [left]
        for op, comparator in zip(node.ops, node.comparators):
            right = _safe_condition_expression(comparator)
            if not right:
                return None
            pieces.extend([_safe_compare_op(op), right])
        return " ".join(pieces)
    if isinstance(node, ast.Call):
        func = _safe_condition_expression(node.func)
        return f"{func}(...)" if func else "call(...)"
    if isinstance(node, ast.Subscript):
        value = _safe_condition_expression(node.value)
        return f"{value}[...]" if value else None
    if isinstance(node, ast.BinOp):
        return "expression"
    return None


def _safe_compare_op(op: ast.cmpop) -> str:
    if isinstance(op, ast.Eq):
        return "=="
    if isinstance(op, ast.NotEq):
        return "!="
    if isinstance(op, ast.Is):
        return "is"
    if isinstance(op, ast.IsNot):
        return "is not"
    if isinstance(op, ast.In):
        return "in"
    if isinstance(op, ast.NotIn):
        return "not in"
    if isinstance(op, ast.Lt):
        return "<"
    if isinstance(op, ast.LtE):
        return "<="
    if isinstance(op, ast.Gt):
        return ">"
    if isinstance(op, ast.GtE):
        return ">="
    return "?"


def _calls_from_function(context: _AnalysisContext, function: FunctionInfo) -> list[FlowEdge]:
    calls = _collect_calls(function.node)
    edges: list[FlowEdge] = []
    seen: set[str] = set()
    variable_types = _collect_variable_types(context, function)
    for dependency_edge in _parameter_dependency_edges(context, function):
        if dependency_edge.edge["id"] in seen:
            continue
        seen.add(dependency_edge.edge["id"])
        edges.append(dependency_edge)

    for call, is_await in calls:
        call_name = _dotted_name(call.func)
        if call_name is None:
            call_name = _method_name(call.func)
        if call_name is None:
            continue
        dependency_name = _fastapi_dependency_name(call_name, call)
        if dependency_name is not None:
            targets = _resolve_call(context, function, dependency_name, variable_types=variable_types)
            for target, certainty, _, _ in targets:
                edge = _build_edge(
                    function,
                    target,
                    call,
                    "call",
                    certainty,
                    "fastapi_dependency_call",
                    f"Resolved FastAPI dependency Depends({dependency_name})",
                )
                if edge["id"] in seen:
                    continue
                seen.add(edge["id"])
                edges.append(FlowEdge(edge=edge, target=target))
            continue

        targets = _resolve_call(context, function, call_name, variable_types=variable_types)
        for target, certainty, reason_code, reason_label in targets:
            kind: EdgeKind = "await" if is_await else "call"
            edge = _build_edge(function, target, call, kind, certainty, reason_code, reason_label)
            if edge["id"] in seen:
                continue
            seen.add(edge["id"])
            edges.append(FlowEdge(edge=edge, target=target))

        external_call_name = _expanded_call_name(context, function, call_name)
        external = _external_interaction(external_call_name, call)
        if external is not None and not targets:
            category, reason_code, reason_label = external
            target_node_id = _external_node_id(category, external_call_name)
            edge = _build_external_edge(function, target_node_id, call, reason_code, reason_label)
            if edge["id"] in seen:
                continue
            seen.add(edge["id"])
            edges.append(FlowEdge(edge=edge, target=None))
    return sorted(edges, key=lambda item: item.edge["id"])


def _parameter_dependency_edges(context: _AnalysisContext, function: FunctionInfo) -> list[FlowEdge]:
    aliases = context.fastapi_dependency_aliases_by_path.get(function.relative_path, {})
    edges: list[FlowEdge] = []
    for arg in [*function.node.args.posonlyargs, *function.node.args.args, *function.node.args.kwonlyargs]:
        if arg.annotation is None:
            continue
        dependency = aliases.get(ast.unparse(arg.annotation))
        if dependency is None:
            continue
        edge = _build_edge(
            function,
            dependency,
            arg.annotation,
            "call",
            "confirmed",
            "fastapi_dependency_alias_call",
            f"Resolved FastAPI dependency alias {ast.unparse(arg.annotation)}",
        )
        edges.append(FlowEdge(edge=edge, target=dependency))
    return sorted(edges, key=lambda item: item.edge["id"])


def _fastapi_dependency_name(call_name: str, call: ast.Call) -> str | None:
    if call_name.rsplit(".", 1)[-1] != "Depends":
        return None
    dependency: ast.AST | None = call.args[0] if call.args else None
    if dependency is None:
        dependency = next((keyword.value for keyword in call.keywords if keyword.arg == "dependency"), None)
    if dependency is None:
        return None
    return _dotted_name(dependency)


def _expanded_call_name(context: _AnalysisContext, function: FunctionInfo, call_name: str) -> str:
    first, separator, rest = call_name.partition(".")
    alias = context.import_aliases_by_path.get(function.relative_path, {}).get(first)
    if alias is None:
        return call_name
    return f"{alias}.{rest}" if separator else alias


def _resolve_call(
    context: _AnalysisContext,
    function: FunctionInfo,
    call_name: str,
    *,
    variable_types: dict[str, str],
) -> list[tuple[FunctionInfo, Certainty, str, str]]:
    same_file = context.functions_by_path.get(function.relative_path, ())
    module = context.module_by_path[function.relative_path]
    aliases = context.import_aliases_by_path.get(function.relative_path, {})

    if call_name.startswith("self.") and function.parent_qualified_name is not None:
        method_name = call_name.split(".", 1)[1]
        target = _find_qualified(same_file, f"{function.parent_qualified_name}.{method_name}")
        if target is not None:
            return [(target, "confirmed", "self_method_call", f"Resolved self.{method_name}() in current class")]

    receiver, separator, method_name = call_name.partition(".")
    if separator and method_name == "func":
        dispatch_targets = context.argparse_dispatch_targets.get("func", ())
        if len(dispatch_targets) == 1:
            return [(dispatch_targets[0], "confirmed", "argparse_dispatch_call", f"Resolved argparse dispatch {call_name}()")]
        if len(dispatch_targets) > 1:
            return [
                (target, "uncertain", "ambiguous_argparse_dispatch", f"Ambiguous argparse dispatch {call_name}() could target this handler")
                for target in dispatch_targets[:5]
            ]

    if separator and receiver in variable_types:
        method_targets = _resolve_method_targets(context, function, variable_types[receiver], method_name)
        if len(method_targets) == 1:
            reason = "type_hint_method_call" if variable_types[receiver].startswith("hint:") else "instantiated_method_call"
            label = "type hint" if reason == "type_hint_method_call" else "direct instantiation"
            return [(method_targets[0], "confirmed", reason, f"Resolved {receiver}.{method_name}() from {label}")]
        if len(method_targets) > 1:
            return [
                (target, "uncertain", "ambiguous_method_call", f"Ambiguous method call {receiver}.{method_name}() could target this method")
                for target in method_targets[:5]
            ]

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


def _collect_variable_types(context: _AnalysisContext, function: FunctionInfo) -> dict[str, str]:
    variable_types: dict[str, str] = {}
    for arg in [*function.node.args.posonlyargs, *function.node.args.args, *function.node.args.kwonlyargs]:
        if arg.annotation is None:
            continue
        annotation = ast.unparse(arg.annotation)
        expanded_annotation = _expanded_call_name(context, function, annotation)
        if _is_known_class(context, expanded_annotation):
            variable_types[arg.arg] = f"hint:{expanded_annotation}"

    for node in ast.walk(function.node):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.Lambda)) and node is not function.node:
            continue
        if isinstance(node, ast.Assign) and isinstance(node.value, ast.Call):
            class_name = _expanded_call_name(context, function, _dotted_name(node.value.func) or "")
            if _is_known_class(context, class_name):
                for target in node.targets:
                    if isinstance(target, ast.Name):
                        variable_types[target.id] = class_name
        elif isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name):
            annotation = ast.unparse(node.annotation)
            expanded_annotation = _expanded_call_name(context, function, annotation)
            if _is_known_class(context, expanded_annotation):
                variable_types[node.target.id] = f"hint:{expanded_annotation}"
            if isinstance(node.value, ast.Call):
                class_name = _expanded_call_name(context, function, _dotted_name(node.value.func) or "")
                if _is_known_class(context, class_name):
                    variable_types[node.target.id] = class_name
    return variable_types


def _is_known_class(context: _AnalysisContext, class_name: str) -> bool:
    normalized = class_name.removeprefix("hint:")
    if normalized in context.classes_by_module_qualified_name:
        return True
    short_name = normalized.rsplit(".", 1)[-1]
    return short_name in context.classes_by_name


def _resolve_method_targets(context: _AnalysisContext, function: FunctionInfo, class_name: str, method_name: str) -> list[FunctionInfo]:
    normalized = class_name.removeprefix("hint:")
    class_infos = []
    if normalized in context.classes_by_module_qualified_name:
        class_infos = [context.classes_by_module_qualified_name[normalized]]
    else:
        short_name = normalized.rsplit(".", 1)[-1]
        class_infos = list(context.classes_by_name.get(short_name, ()))

    targets: list[FunctionInfo] = []
    for class_info in class_infos:
        target = _find_qualified(
            context.functions_by_path.get(class_info.relative_path, ()),
            f"{class_info.qualified_name}.{method_name}",
        )
        if target is not None:
            targets.append(target)
    return sorted(targets, key=lambda target: (target.relative_path, target.qualified_name))


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


def _external_interaction(call_name: str, call: ast.Call) -> tuple[str, str, str] | None:
    normalized = call_name.lower()
    attr = _method_name(call.func)

    if normalized == "open" or normalized.startswith("shutil."):
        return "filesystem", "filesystem_call", f"Filesystem interaction via {call_name}()"
    if attr in {"read_text", "write_text", "read_bytes", "write_bytes", "open", "mkdir", "unlink", "rmdir", "rename", "replace", "glob", "rglob", "iterdir", "exists", "stat"}:
        return "filesystem", "filesystem_method_call", f"Filesystem interaction via .{attr}()"

    if normalized in {"os.system", "os.popen"} or normalized.startswith("subprocess."):
        return "subprocess", "subprocess_call", f"Subprocess/shell interaction via {call_name}()"

    if normalized.startswith(("requests.", "httpx.", "urllib.request.", "aiohttp.")):
        return "network", "network_call", f"HTTP/network interaction via {call_name}()"
    if attr in {"get", "post", "put", "patch", "delete", "request"} and _looks_like_url_argument(call):
        return "network", "network_method_call", f"HTTP/network interaction via .{attr}()"

    if normalized.startswith(("sqlite3.", "psycopg2.", "pymysql.", "mysql.connector.", "sqlalchemy.")):
        return "database", "database_call", f"Database interaction via {call_name}()"
    if attr in {"execute", "executemany", "query", "commit", "rollback", "connect"}:
        return "database", "database_method_call", f"Database interaction via .{attr}()"
    if attr in {
        "save",
        "delete",
        "filter",
        "exclude",
        "create",
        "update",
        "select_related",
        "prefetch_related",
    }:
        return "database", "orm_method_call", f"Likely ORM/database interaction via .{attr}()"

    return None


def _looks_like_url_argument(call: ast.Call) -> bool:
    for arg in call.args:
        if isinstance(arg, ast.Constant) and isinstance(arg.value, str) and arg.value.startswith(("http://", "https://")):
            return True
    return False


def _external_node_id(category: str, call_name: str) -> str:
    safe_name = call_name.replace(":", "_").replace("/", "_")
    return f"node:external:{category}:{safe_name}"


def _external_node_from_id(node_id: str) -> GraphNode:
    _, _, category, label = node_id.split(":", 3)
    return {
        "id": node_id,
        "kind": "external",
        "label": f"{category}: {label}",
        "qualified_name": label,
    }


def _build_external_edge(
    source: FunctionInfo,
    target_node_id: str,
    call: ast.Call,
    reason_code: str,
    reason_label: str,
) -> GraphEdge:
    return {
        "id": f"edge:external_interaction:confirmed:{source.node_id}->{target_node_id}:{call.lineno}:{call.col_offset}",
        "kind": "external_interaction",
        "source": source.node_id,
        "target": target_node_id,
        "certainty": "confirmed",
        "evidence": _evidence(source.relative_path, call, reason_code, reason_label),
    }


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
    indexed: dict[str, FunctionInfo] = {}
    for fn in functions:
        for module_name in _module_name_aliases(module_by_path[fn.relative_path]):
            indexed[f"{module_name}.{fn.qualified_name}"] = fn
    return indexed


def _classes_by_name(classes: tuple[ClassInfo, ...]) -> dict[str, tuple[ClassInfo, ...]]:
    grouped: dict[str, list[ClassInfo]] = {}
    for cls in classes:
        grouped.setdefault(cls.name, []).append(cls)
    return {key: tuple(sorted(value, key=lambda cls: (cls.relative_path, cls.qualified_name))) for key, value in grouped.items()}


def _classes_by_module_qualified_name(modules: tuple[ModuleInfo, ...], classes: tuple[ClassInfo, ...]) -> dict[str, ClassInfo]:
    module_by_path = {module.relative_path: module for module in modules}
    indexed: dict[str, ClassInfo] = {}
    for cls in classes:
        for module_name in _module_name_aliases(module_by_path[cls.relative_path]):
            indexed[f"{module_name}.{cls.qualified_name}"] = cls
    return indexed


def _module_name_aliases(module: ModuleInfo) -> tuple[str, ...]:
    """Return importable module-name aliases for common source-root layouts."""

    aliases = {module.qualified_name}
    parts = module.relative_path.split("/")
    if "src" in parts:
        src_index = len(parts) - 1 - list(reversed(parts)).index("src")
        suffix_parts = parts[src_index + 1 :]
        suffix_name = _module_name_from_parts(suffix_parts)
        if suffix_name:
            aliases.add(suffix_name)
    return tuple(sorted(aliases))


def _module_name_from_parts(parts: list[str]) -> str | None:
    if not parts:
        return None
    if parts[-1] == "__init__.py":
        module_parts = parts[:-1]
    elif parts[-1].endswith(".py"):
        module_parts = [*parts[:-1], parts[-1][:-3]]
    else:
        module_parts = parts
    return ".".join(part for part in module_parts if part) or None


def _fastapi_dependency_aliases_by_path(context: _AnalysisContext) -> dict[str, dict[str, FunctionInfo]]:
    alias_definitions_by_path: dict[str, dict[str, FunctionInfo]] = {}
    alias_definitions_by_qualified_name: dict[str, FunctionInfo] = {}

    for module in context.discovery.modules:
        module_aliases: dict[str, FunctionInfo] = {}
        for stmt in module.tree.body:
            target_names = _assignment_target_names(stmt)
            if not target_names:
                continue
            value = stmt.value if isinstance(stmt, (ast.Assign, ast.AnnAssign)) else None
            dependency_name = _annotated_dependency_name(value)
            if dependency_name is None:
                continue
            dependency = _resolve_function_reference(context, module.relative_path, dependency_name)
            if dependency is None:
                continue
            for target_name in target_names:
                module_aliases[target_name] = dependency
                for module_name in _module_name_aliases(module):
                    alias_definitions_by_qualified_name[f"{module_name}.{target_name}"] = dependency
        alias_definitions_by_path[module.relative_path] = module_aliases

    resolved = {path: dict(aliases) for path, aliases in alias_definitions_by_path.items()}
    for path, imports in context.import_aliases_by_path.items():
        for local_name, imported_name in imports.items():
            dependency = alias_definitions_by_qualified_name.get(imported_name)
            if dependency is not None:
                resolved.setdefault(path, {})[local_name] = dependency
    return resolved


def _assignment_target_names(stmt: ast.stmt) -> tuple[str, ...]:
    if isinstance(stmt, ast.Assign):
        return tuple(target.id for target in stmt.targets if isinstance(target, ast.Name))
    if isinstance(stmt, ast.AnnAssign) and isinstance(stmt.target, ast.Name):
        return (stmt.target.id,)
    return ()


def _annotated_dependency_name(node: ast.AST | None) -> str | None:
    if not isinstance(node, ast.Subscript):
        return None
    annotated_name = _dotted_name(node.value)
    if annotated_name not in {"Annotated", "typing.Annotated"}:
        return None
    slice_values = node.slice.elts if isinstance(node.slice, ast.Tuple) else [node.slice]
    for item in slice_values[1:]:
        if not isinstance(item, ast.Call):
            continue
        call_name = _dotted_name(item.func)
        if call_name is None:
            continue
        dependency_name = _fastapi_dependency_name(call_name, item)
        if dependency_name is not None:
            return dependency_name
    return None


def _argparse_dispatch_targets(context: _AnalysisContext) -> dict[str, tuple[FunctionInfo, ...]]:
    grouped: dict[str, list[FunctionInfo]] = {}
    for module in context.discovery.modules:
        for node in ast.walk(module.tree):
            if not isinstance(node, ast.Call):
                continue
            call_name = _dotted_name(node.func)
            if call_name is None or not call_name.endswith(".set_defaults"):
                continue
            for keyword in node.keywords:
                if keyword.arg is None:
                    continue
                handler_name = _dotted_name(keyword.value)
                if handler_name is None:
                    continue
                handler = _resolve_function_reference(context, module.relative_path, handler_name)
                if handler is not None:
                    grouped.setdefault(keyword.arg, []).append(handler)
    return {
        attr: tuple(sorted({handler.node_id: handler for handler in handlers}.values(), key=lambda fn: (fn.relative_path, fn.qualified_name)))
        for attr, handlers in grouped.items()
    }


def _resolve_function_reference(context: _AnalysisContext, relative_path: str, name: str) -> FunctionInfo | None:
    same_file = context.functions_by_path.get(relative_path, ())
    local = _find_qualified(same_file, name)
    if local is not None:
        return local
    aliases = context.import_aliases_by_path.get(relative_path, {})
    imported = aliases.get(name)
    if imported is not None:
        return context.functions_by_module_qualified_name.get(imported)
    first, separator, rest = name.partition(".")
    if separator and first in aliases:
        return context.functions_by_module_qualified_name.get(f"{aliases[first]}.{rest}")
    return context.functions_by_module_qualified_name.get(name)


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


def _method_name(node: ast.AST) -> str | None:
    if isinstance(node, ast.Attribute):
        return node.attr
    return None


def _dotted_name(node: ast.AST) -> str | None:
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        parent = _dotted_name(node.value)
        return f"{parent}.{node.attr}" if parent else node.attr
    return None
