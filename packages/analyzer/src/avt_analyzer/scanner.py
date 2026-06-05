"""Project file scanning for AVT analyzer."""

from __future__ import annotations

import ast
from dataclasses import dataclass
from pathlib import Path

from avt_analyzer.schema import GraphWarning

EXCLUDED_DIR_NAMES = {
    ".git",
    ".hg",
    ".mypy_cache",
    ".pytest_cache",
    ".ruff_cache",
    ".tox",
    ".venv",
    "__pycache__",
    "build",
    "dist",
    "node_modules",
    "site-packages",
    "vendor",
}

SCRIPT_DIR_NAMES = {"bin", "scripts", "tools"}


@dataclass(frozen=True)
class PythonFile:
    """A parsed Python source file inside an analyzed project."""

    path: Path
    relative_path: str
    source: str
    tree: ast.Module
    has_shebang: bool


@dataclass(frozen=True)
class ScanResult:
    """Result of scanning a project for analyzable Python files."""

    project_path: Path
    files: tuple[PythonFile, ...]
    warnings: tuple[GraphWarning, ...]


def scan_python_project(project_path: Path, *, include_tests: bool = False) -> ScanResult:
    """Find and parse Python files under ``project_path`` deterministically."""

    files: list[PythonFile] = []
    warnings: list[GraphWarning] = []

    for path in sorted(project_path.rglob("*.py"), key=lambda item: item.relative_to(project_path).as_posix()):
        relative = path.relative_to(project_path)
        relative_path = relative.as_posix()
        parts = relative.parts

        if _is_excluded(parts, include_tests=include_tests):
            continue

        try:
            source = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            warnings.append(
                {
                    "code": "decode_error",
                    "message": f"Could not decode Python file as UTF-8: {relative_path}",
                    "location": {"path": relative_path, "line": 1, "column": 0},
                }
            )
            continue
        except OSError as exc:
            warnings.append(
                {
                    "code": "read_error",
                    "message": f"Could not read Python file {relative_path}: {exc}",
                    "location": {"path": relative_path, "line": 1, "column": 0},
                }
            )
            continue

        try:
            tree = ast.parse(source, filename=relative_path)
        except SyntaxError as exc:
            warnings.append(
                {
                    "code": "syntax_error",
                    "message": f"Could not parse Python file {relative_path}: {exc.msg}",
                    "location": {"path": relative_path, "line": exc.lineno or 1, "column": exc.offset or 0},
                }
            )
            continue

        files.append(
            PythonFile(
                path=path,
                relative_path=relative_path,
                source=source,
                tree=tree,
                has_shebang=source.startswith("#!"),
            )
        )

    return ScanResult(project_path=project_path, files=tuple(files), warnings=tuple(warnings))


def _is_excluded(parts: tuple[str, ...], *, include_tests: bool) -> bool:
    for part in parts[:-1]:
        if part in EXCLUDED_DIR_NAMES or part == "migrations":
            return True
        if not include_tests and part in {"test", "tests"}:
            return True

    filename = parts[-1]
    if not include_tests and (filename.startswith("test_") or filename.endswith("_test.py")):
        return True

    return False
