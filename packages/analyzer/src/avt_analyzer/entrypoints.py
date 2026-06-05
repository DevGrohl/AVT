"""Entry Point discovery for Python projects."""

from __future__ import annotations

import ast
from dataclasses import dataclass
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

    @property
    def id(self) -> str:
        loc = self.evidence["location"]
        return f"entry:{self.kind}:{self.function.relative_path}:{self.function.qualified_name}:{loc['line']}"

    @property
    def label(self) -> str:
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
        modules.append(ModuleInfo(python_file.relative_path))
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
                kind, code, label = reason
                _add_candidate(candidates, seen, kind, fn, decorator, code, label)

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


def _decorator_entry_reason(decorator: ast.expr) -> tuple[EntryPointKind, str, str] | None:
    target = decorator.func if isinstance(decorator, ast.Call) else decorator
    dotted = _dotted_name(target)
    if dotted is None:
        return None

    parts = dotted.split(".")
    last = parts[-1]
    if last in {"route", "get", "post", "put", "delete", "patch", "options", "head", "api_route", "websocket"}:
        return "web_route", "web_route_decorator", f"Web route decorator @{dotted}"
    if last in {"command", "group", "callback"}:
        return "cli_command", "cli_decorator", f"CLI command decorator @{dotted}"
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
        )
    )


def _called_name(call: ast.Call) -> str | None:
    return _dotted_name(call.func)


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
