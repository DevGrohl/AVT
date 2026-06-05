"""Entry Point discovery for Python projects."""

from __future__ import annotations

import ast
from dataclasses import dataclass, replace
from pathlib import PurePosixPath
from typing import Iterable

from avt_analyzer.scanner import PythonFile, SCRIPT_DIR_NAMES, ScanResult
from avt_analyzer.schema import EntryPointKind, Evidence, GraphWarning, NodeKind, SourceLocation


@dataclass(frozen=True)
class FunctionInfo:
    relative_path: str
    qualified_name: str
    name: str
    node: ast.FunctionDef | ast.AsyncFunctionDef
    parent_qualified_name: str | None
    node_kind: NodeKind
    signature: str
    type_hints: dict[str, str]

    @property
    def node_id(self) -> str:
        return f"node:{self.node_kind}:{self.relative_path}:{self.qualified_name}"


@dataclass(frozen=True)
class ClassInfo:
    relative_path: str
    qualified_name: str
    name: str
    node: ast.ClassDef
    parent_qualified_name: str | None

    @property
    def node_id(self) -> str:
        return f"node:class:{self.relative_path}:{self.qualified_name}"


@dataclass(frozen=True)
class ModuleInfo:
    relative_path: str
    tree: ast.Module

    @property
    def qualified_name(self) -> str:
        path = PurePosixPath(self.relative_path)
        if path.name == "__init__.py":
            return ".".join(path.parent.parts) or "__init__"
        return ".".join((*path.parent.parts, path.stem))

    @property
    def node_id(self) -> str:
        return f"node:module:{self.relative_path}"


@dataclass(frozen=True)
class EntryPointCandidate:
    kind: EntryPointKind
    function: FunctionInfo
    evidence: Evidence
    route_path: str | None = None
    http_methods: tuple[str, ...] = ()

    @property
    def id(self) -> str:
        loc = self.evidence["location"]
        return f"entry:{self.kind}:{self.function.relative_path}:{self.function.qualified_name}:{loc['line']}"

    @property
    def label(self) -> str:
        if self.kind == "web_route" and (self.http_methods or self.route_path):
            methods = ",".join(self.http_methods) if self.http_methods else "ROUTE"
            path = self.route_path or "?"
            return f"{methods} {path}: {self.function.relative_path}:{self.function.qualified_name}"
        return f"{self.kind}: {self.function.relative_path}:{self.function.qualified_name}"


@dataclass(frozen=True)
class DiscoveryResult:
    modules: tuple[ModuleInfo, ...]
    classes: tuple[ClassInfo, ...]
    functions: tuple[FunctionInfo, ...]
    entry_points: tuple[EntryPointCandidate, ...]
    warnings: tuple[GraphWarning, ...]


def discover_entry_points(scan: ScanResult, *, manual_entries: Iterable[str] = ()) -> DiscoveryResult:
    modules: list[ModuleInfo] = []
    classes: list[ClassInfo] = []
    functions: list[FunctionInfo] = []
    warnings: list[GraphWarning] = []

    for python_file in scan.files:
        modules.append(ModuleInfo(python_file.relative_path, python_file.tree))
        file_classes, file_functions = _collect_symbols(python_file)
        classes.extend(file_classes)
        functions.extend(file_functions)

    function_index = {(fn.relative_path, fn.qualified_name): fn for fn in functions}
    by_file: dict[str, list[FunctionInfo]] = {}
    for fn in functions:
        by_file.setdefault(fn.relative_path, []).append(fn)

    candidates: list[EntryPointCandidate] = []
    seen: set[tuple[str, str, str, int]] = set()

    for python_file in scan.files:
        file_functions = by_file.get(python_file.relative_path, [])
        file_function_names = {fn.qualified_name: fn for fn in file_functions}

        for fn in file_functions:
            for decorator in fn.node.decorator_list:
                reason = _decorator_entry_reason(decorator)
                if reason is None:
                    continue
                kind, code, label, route_path, http_methods = reason
                route_path = _full_route_path(python_file.relative_path, decorator, route_path, scan.files)
                _add_candidate(candidates, seen, kind, fn, decorator, code, label, route_path, http_methods)

        for call in _main_guard_calls(python_file.tree):
            target_name = _called_name(call)
            fn = file_function_names.get(target_name or "")
            if fn is None and "main" in file_function_names:
                fn = file_function_names["main"]
            if fn is not None:
                _add_candidate(candidates, seen, "cli_command", fn, call, "cli_main_guard", "Called from if __name__ == '__main__'")

        script_fn = _script_entry_function(python_file, file_function_names)
        if script_fn is not None:
            _add_candidate(
                candidates,
                seen,
                "script",
                script_fn,
                script_fn.node,
                "script_file",
                "Executable script candidate",
            )

    for manual in manual_entries:
        try:
            relative_path, qualified_name = manual.split(":", 1)
        except ValueError:
            warnings.append({"code": "invalid_manual_entry", "message": f"Manual Entry Point must be path.py:qualified.name: {manual}"})
            continue
        fn = function_index.get((PurePosixPath(relative_path).as_posix(), qualified_name))
        if fn is None:
            warnings.append({"code": "manual_entry_not_found", "message": f"Manual Entry Point not found: {manual}"})
            continue
        _add_candidate(candidates, seen, "manual", fn, fn.node, "manual_entry", "Manual Entry Point requested")

    return DiscoveryResult(
        modules=tuple(sorted(modules, key=lambda item: item.relative_path)),
        classes=tuple(sorted(classes, key=lambda item: (item.relative_path, item.qualified_name))),
        functions=tuple(sorted(functions, key=lambda item: (item.relative_path, item.qualified_name))),
        entry_points=tuple(sorted(candidates, key=lambda item: item.id)),
        warnings=tuple(warnings),
    )


def _collect_symbols(python_file: PythonFile) -> tuple[list[ClassInfo], list[FunctionInfo]]:
    classes: list[ClassInfo] = []
    functions: list[FunctionInfo] = []

    def visit_body(body: list[ast.stmt], prefix: list[str], parent_qualified_name: str | None) -> None:
        for stmt in body:
            if isinstance(stmt, ast.ClassDef):
                qualified = ".".join((*prefix, stmt.name))
                classes.append(ClassInfo(python_file.relative_path, qualified, stmt.name, stmt, parent_qualified_name))
                visit_body(stmt.body, [*prefix, stmt.name], qualified)
            elif isinstance(stmt, (ast.FunctionDef, ast.AsyncFunctionDef)):
                qualified = ".".join((*prefix, stmt.name))
                in_class = parent_qualified_name is not None and prefix and any(
                    cls.qualified_name == ".".join(prefix) for cls in classes
                )
                functions.append(
                    FunctionInfo(
                        relative_path=python_file.relative_path,
                        qualified_name=qualified,
                        name=stmt.name,
                        node=stmt,
                        parent_qualified_name=parent_qualified_name,
                        node_kind="method" if in_class else "function",
                        signature=_format_signature(stmt),
                        type_hints=_collect_type_hints(stmt),
                    )
                )
                visit_body(stmt.body, [*prefix, stmt.name], qualified)

    visit_body(python_file.tree.body, [], None)
    return classes, functions


def _decorator_entry_reason(decorator: ast.expr) -> tuple[EntryPointKind, str, str, str | None, tuple[str, ...]] | None:
    target = decorator.func if isinstance(decorator, ast.Call) else decorator
    dotted = _dotted_name(target)
    if dotted is None:
        return None

    parts = dotted.split(".")
    last = parts[-1]
    if last in {
        "route",
        "get",
        "post",
        "put",
        "delete",
        "patch",
        "options",
        "head",
        "api_route",
        "websocket",
        "api_view",
        "action",
    }:
        route_path = _route_path(decorator)
        http_methods = _http_methods(last, decorator)
        return "web_route", "web_route_decorator", f"Web route decorator @{dotted}", route_path, http_methods
    if last in {"command", "group", "callback"}:
        return "cli_command", "cli_decorator", f"CLI command decorator @{dotted}", None, ()
    return None


def _main_guard_calls(tree: ast.Module) -> list[ast.Call]:
    calls: list[ast.Call] = []
    for stmt in tree.body:
        if isinstance(stmt, ast.If) and _is_main_guard(stmt.test):
            for child in ast.walk(ast.Module(body=stmt.body, type_ignores=[])):
                if isinstance(child, ast.Call):
                    calls.append(child)
    return calls


def _is_main_guard(test: ast.expr) -> bool:
    if not isinstance(test, ast.Compare) or len(test.ops) != 1 or not isinstance(test.ops[0], ast.Eq):
        return False
    expressions = [test.left, *test.comparators]
    return any(isinstance(expr, ast.Name) and expr.id == "__name__" for expr in expressions) and any(
        isinstance(expr, ast.Constant) and expr.value == "__main__" for expr in expressions
    )


def _script_entry_function(python_file: PythonFile, functions: dict[str, FunctionInfo]) -> FunctionInfo | None:
    parts = PurePosixPath(python_file.relative_path).parts
    is_script_path = bool(parts) and (parts[0] in SCRIPT_DIR_NAMES or parts[-1] == "__main__.py")
    if not (python_file.has_shebang or is_script_path):
        return None
    return functions.get("main") or next((fn for fn in functions.values() if "." not in fn.qualified_name), None)


def _add_candidate(
    candidates: list[EntryPointCandidate],
    seen: set[tuple[str, str, str, int]],
    kind: EntryPointKind,
    fn: FunctionInfo,
    node: ast.AST,
    reason_code: str,
    reason_label: str,
    route_path: str | None = None,
    http_methods: tuple[str, ...] = (),
) -> None:
    line = getattr(node, "lineno", fn.node.lineno)
    key = (kind, fn.relative_path, fn.qualified_name, line)
    if key in seen:
        return
    seen.add(key)
    candidates.append(
        EntryPointCandidate(
            kind=kind,
            function=fn,
            evidence={
                "location": _source_location(fn.relative_path, node),
                "reason": {"code": reason_code, "label": reason_label},
            },
            route_path=route_path,
            http_methods=http_methods,
        )
    )


def _route_path(decorator: ast.expr) -> str | None:
    if not isinstance(decorator, ast.Call) or not decorator.args:
        return None
    first_arg = decorator.args[0]
    if isinstance(first_arg, ast.Constant) and isinstance(first_arg.value, str):
        return first_arg.value
    return None


def _http_methods(decorator_name: str, decorator: ast.expr) -> tuple[str, ...]:
    if decorator_name in {"get", "post", "put", "delete", "patch", "options", "head"}:
        return (decorator_name.upper(),)
    if decorator_name == "websocket":
        return ("WEBSOCKET",)
    if decorator_name in {"route", "api_route", "action"} and isinstance(decorator, ast.Call):
        methods = _string_list_keyword(decorator, "methods")
        if methods:
            return tuple(sorted(method.upper() for method in methods))
    if decorator_name == "api_view" and isinstance(decorator, ast.Call) and decorator.args:
        methods = _string_list(decorator.args[0])
        if methods:
            return tuple(sorted(method.upper() for method in methods))
    return ()


def _full_route_path(relative_path: str, decorator: ast.expr, route_path: str | None, files: tuple[PythonFile, ...]) -> str | None:
    if route_path is None:
        return None
    router_name = _decorator_root_name(decorator)
    if router_name is None:
        return route_path
    full_prefixes = _router_full_prefixes(files)
    prefix = full_prefixes.get((relative_path, router_name), "")
    return _join_route_paths(prefix, route_path)


def _decorator_root_name(decorator: ast.expr) -> str | None:
    target = decorator.func if isinstance(decorator, ast.Call) else decorator
    while isinstance(target, ast.Attribute):
        target = target.value
    if isinstance(target, ast.Name):
        return target.id
    return None


def _router_full_prefixes(files: tuple[PythonFile, ...]) -> dict[tuple[str, str], str]:
    router_prefixes: dict[tuple[str, str], str] = {}
    import_aliases: dict[str, dict[str, tuple[str, str]]] = {}
    module_path_by_qualified = {ModuleInfo(file.relative_path, file.tree).qualified_name: file.relative_path for file in files}
    include_edges: list[tuple[tuple[str, str] | None, tuple[str, str], str]] = []

    for file in files:
        local_imports: dict[str, tuple[str, str]] = {}
        for stmt in file.tree.body:
            if isinstance(stmt, ast.ImportFrom) and stmt.module is not None:
                module_path = module_path_by_qualified.get(stmt.module)
                if module_path is None:
                    continue
                for alias in stmt.names:
                    local_imports[alias.asname or alias.name] = (module_path, alias.name)
        import_aliases[file.relative_path] = local_imports

    for file in files:
        for stmt in ast.walk(file.tree):
            if isinstance(stmt, ast.Assign) and isinstance(stmt.value, ast.Call) and _called_name(stmt.value) == "APIRouter":
                prefix = _string_keyword(stmt.value, "prefix") or ""
                for target in stmt.targets:
                    if isinstance(target, ast.Name):
                        router_prefixes[(file.relative_path, target.id)] = prefix
            elif isinstance(stmt, ast.Call) and _method_name(stmt.func) == "include_router" and stmt.args:
                parent_name = _include_router_parent_name(stmt)
                parent = (file.relative_path, parent_name) if parent_name in {name for path, name in router_prefixes if path == file.relative_path} else None
                child = _router_identity(file.relative_path, stmt.args[0], import_aliases.get(file.relative_path, {}))
                if child is None:
                    continue
                include_edges.append((parent, child, _string_keyword(stmt, "prefix") or ""))

    full: dict[tuple[str, str], str] = {}
    changed = True
    while changed:
        changed = False
        for parent, child, include_prefix in include_edges:
            if parent is not None and parent not in full:
                continue
            parent_prefix = full.get(parent, "") if parent is not None else ""
            next_prefix = _join_route_paths(parent_prefix, include_prefix, router_prefixes.get(child, ""))
            if full.get(child) != next_prefix:
                full[child] = next_prefix
                changed = True
    return {**router_prefixes, **full}


def _include_router_parent_name(call: ast.Call) -> str:
    if isinstance(call.func, ast.Attribute) and isinstance(call.func.value, ast.Name):
        return call.func.value.id
    return ""


def _router_identity(relative_path: str, node: ast.AST, imports: dict[str, tuple[str, str]]) -> tuple[str, str] | None:
    if isinstance(node, ast.Name):
        return imports.get(node.id) or (relative_path, node.id)
    return None


def _string_keyword(call: ast.Call, keyword_name: str) -> str | None:
    for keyword in call.keywords:
        if keyword.arg == keyword_name and isinstance(keyword.value, ast.Constant) and isinstance(keyword.value.value, str):
            return keyword.value.value
    return None


def _join_route_paths(*parts: str) -> str:
    cleaned = [part.strip("/") for part in parts if part]
    if not cleaned:
        return "/"
    joined = "/".join(part for part in cleaned if part)
    return f"/{joined}" if joined else "/"


def _string_list_keyword(call: ast.Call, keyword_name: str) -> tuple[str, ...]:
    for keyword in call.keywords:
        if keyword.arg == keyword_name:
            return _string_list(keyword.value)
    return ()


def _string_list(node: ast.AST) -> tuple[str, ...]:
    if isinstance(node, (ast.List, ast.Tuple, ast.Set)):
        values = []
        for item in node.elts:
            if isinstance(item, ast.Constant) and isinstance(item.value, str):
                values.append(item.value)
        return tuple(values)
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return (node.value,)
    return ()


def _called_name(call: ast.Call) -> str | None:
    return _dotted_name(call.func)


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


def _format_signature(node: ast.FunctionDef | ast.AsyncFunctionDef) -> str:
    return f"{node.name}{_format_arguments(node.args)}{_format_return(node)}"


def _format_arguments(args: ast.arguments) -> str:
    parts: list[str] = []
    positional = [*args.posonlyargs, *args.args]
    default_offset = len(positional) - len(args.defaults)
    for index, arg in enumerate(positional):
        if index == len(args.posonlyargs) and args.posonlyargs:
            parts.append("/")
        rendered = _format_arg(arg)
        if index >= default_offset:
            rendered += "=..."
        parts.append(rendered)
    if args.vararg:
        parts.append("*" + _format_arg(args.vararg))
    elif args.kwonlyargs:
        parts.append("*")
    for arg, default in zip(args.kwonlyargs, args.kw_defaults, strict=True):
        rendered = _format_arg(arg)
        if default is not None:
            rendered += "=..."
        parts.append(rendered)
    if args.kwarg:
        parts.append("**" + _format_arg(args.kwarg))
    return f"({', '.join(parts)})"


def _format_arg(arg: ast.arg) -> str:
    if arg.annotation is None:
        return arg.arg
    return f"{arg.arg}: {ast.unparse(arg.annotation)}"


def _format_return(node: ast.FunctionDef | ast.AsyncFunctionDef) -> str:
    if node.returns is None:
        return ""
    return f" -> {ast.unparse(node.returns)}"


def _collect_type_hints(node: ast.FunctionDef | ast.AsyncFunctionDef) -> dict[str, str]:
    hints: dict[str, str] = {}
    for arg in [*node.args.posonlyargs, *node.args.args, *node.args.kwonlyargs]:
        if arg.annotation is not None:
            hints[arg.arg] = ast.unparse(arg.annotation)
    if node.args.vararg and node.args.vararg.annotation is not None:
        hints[f"*{node.args.vararg.arg}"] = ast.unparse(node.args.vararg.annotation)
    if node.args.kwarg and node.args.kwarg.annotation is not None:
        hints[f"**{node.args.kwarg.arg}"] = ast.unparse(node.args.kwarg.annotation)
    if node.returns is not None:
        hints["return"] = ast.unparse(node.returns)
    return hints
