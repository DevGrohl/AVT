"""Output-safety scanning for analyzer graph generation.

This is not a security scanner. It only protects AVT output from carrying
secret-looking raw values and records safe warnings for Developer awareness.
"""

from __future__ import annotations

import ast
import re

from avt_analyzer.scanner import ScanResult
from avt_analyzer.schema import GraphWarning, SourceLocation

SECRET_NAME_RE = re.compile(r"(secret|token|password|passwd|pwd|api[_-]?key|private[_-]?key|credential|auth)", re.IGNORECASE)
SECRET_VALUE_RE = re.compile(
    r"(-----BEGIN [A-Z ]*PRIVATE KEY-----|ghp_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9]{16,}|xox[baprs]-[A-Za-z0-9-]{10,})"
)


def scan_safety(scan: ScanResult) -> tuple[GraphWarning, ...]:
    """Scan parsed Python files for output-safety warnings.

    Warnings include locations and safe identifiers such as environment variable
    names, but never include raw secret-looking literal values.
    """

    warnings: list[GraphWarning] = []
    seen: set[tuple[str, str, int, int, str]] = set()

    def add(warning: GraphWarning, key: str) -> None:
        location = warning.get("location", {"path": "", "line": 0, "column": 0})
        dedupe_key = (warning["code"], location["path"], location["line"], location["column"], key)
        if dedupe_key in seen:
            return
        seen.add(dedupe_key)
        warnings.append(warning)

    for python_file in scan.files:
        visitor = _SafetyVisitor(python_file.relative_path, add)
        visitor.visit(python_file.tree)

    return tuple(sorted(warnings, key=lambda item: (item.get("location", {}).get("path", ""), item.get("location", {}).get("line", 0), item["code"], item["message"])))


class _SafetyVisitor(ast.NodeVisitor):
    def __init__(self, path: str, add_warning) -> None:  # type: ignore[no-untyped-def]
        self.path = path
        self._add_warning = add_warning

    def visit_Module(self, node: ast.Module) -> None:  # noqa: N802 - ast visitor API
        self._visit_body_without_docstring(node.body)

    def visit_ClassDef(self, node: ast.ClassDef) -> None:  # noqa: N802 - ast visitor API
        for decorator in node.decorator_list:
            self.visit(decorator)
        for base in node.bases:
            self.visit(base)
        for keyword in node.keywords:
            self.visit(keyword)
        self._visit_body_without_docstring(node.body)

    def visit_FunctionDef(self, node: ast.FunctionDef) -> None:  # noqa: N802 - ast visitor API
        self._visit_function(node)

    def visit_AsyncFunctionDef(self, node: ast.AsyncFunctionDef) -> None:  # noqa: N802 - ast visitor API
        self._visit_function(node)

    def visit_Assign(self, node: ast.Assign) -> None:  # noqa: N802 - ast visitor API
        target_names = [_target_name(target) for target in node.targets]
        self._check_secret_assignment(node, [name for name in target_names if name])
        self.generic_visit(node)

    def visit_AnnAssign(self, node: ast.AnnAssign) -> None:  # noqa: N802 - ast visitor API
        target_name = _target_name(node.target)
        if target_name is not None:
            self._check_secret_assignment(node, [target_name])
        self.generic_visit(node)

    def visit_keyword(self, node: ast.keyword) -> None:  # noqa: N802 - ast visitor API
        if node.arg and SECRET_NAME_RE.search(node.arg) and _contains_secret_literal(node.value):
            self._warn_secret_literal(node, node.arg)
        self.generic_visit(node)

    def visit_Dict(self, node: ast.Dict) -> None:  # noqa: N802 - ast visitor API
        for key, value in zip(node.keys, node.values, strict=True):
            if isinstance(key, ast.Constant) and isinstance(key.value, str) and SECRET_NAME_RE.search(key.value) and _contains_secret_literal(value):
                self._warn_secret_literal(value, key.value)
        self.generic_visit(node)

    def visit_Call(self, node: ast.Call) -> None:  # noqa: N802 - ast visitor API
        env_name = _env_var_name(node)
        if env_name is not None:
            self._warn_env_var(node, env_name)
        self.generic_visit(node)

    def visit_Subscript(self, node: ast.Subscript) -> None:  # noqa: N802 - ast visitor API
        if _dotted_name(node.value) in {"os.environ", "environ"}:
            env_name = _constant_string(node.slice)
            if env_name is not None:
                self._warn_env_var(node, env_name)
        self.generic_visit(node)

    def _visit_function(self, node: ast.FunctionDef | ast.AsyncFunctionDef) -> None:
        for decorator in node.decorator_list:
            self.visit(decorator)
        for default in [*node.args.defaults, *node.args.kw_defaults]:
            if default is not None:
                self.visit(default)
        self._visit_body_without_docstring(node.body)

    def _visit_body_without_docstring(self, body: list[ast.stmt]) -> None:
        start = 1 if body and _is_docstring_expr(body[0]) else 0
        for stmt in body[start:]:
            self.visit(stmt)

    def _check_secret_assignment(self, node: ast.AST, target_names: list[str]) -> None:
        value = getattr(node, "value", None)
        if value is None:
            return
        for name in target_names:
            if SECRET_NAME_RE.search(name) and _contains_secret_literal(value):
                self._warn_secret_literal(node, name)

    def _warn_secret_literal(self, node: ast.AST, name: str) -> None:
        self._add_warning(
            {
                "code": "secret_literal_redacted",
                "message": f"Secret-looking literal redacted for {name}",
                "location": _source_location(self.path, node),
            },
            name,
        )

    def _warn_env_var(self, node: ast.AST, name: str) -> None:
        self._add_warning(
            {
                "code": "env_var_reference",
                "message": f"Environment variable referenced: {name}",
                "location": _source_location(self.path, node),
            },
            name,
        )


def _env_var_name(node: ast.Call) -> str | None:
    call_name = _dotted_name(node.func)
    if call_name in {"os.getenv", "os.environ.get", "environ.get"} and node.args:
        return _constant_string(node.args[0])
    return None


def _target_name(node: ast.AST) -> str | None:
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        parent = _target_name(node.value)
        return f"{parent}.{node.attr}" if parent else node.attr
    return None


def _contains_secret_literal(node: ast.AST) -> bool:
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return bool(node.value and (SECRET_VALUE_RE.search(node.value) or len(node.value) >= 12))
    if isinstance(node, (ast.List, ast.Tuple, ast.Set)):
        return any(_contains_secret_literal(item) for item in node.elts)
    if isinstance(node, ast.Dict):
        return any(_contains_secret_literal(value) for value in node.values)
    return False


def _constant_string(node: ast.AST) -> str | None:
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value
    return None


def _is_docstring_expr(node: ast.stmt) -> bool:
    return isinstance(node, ast.Expr) and isinstance(node.value, ast.Constant) and isinstance(node.value.value, str)


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
