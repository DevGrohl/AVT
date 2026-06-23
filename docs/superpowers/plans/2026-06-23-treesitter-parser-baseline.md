# Tree-sitter Parser Baseline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Tree-sitter code-map baseline for JavaScript/TypeScript, Go, and Rust while preserving existing Python Execution Flow behavior.

**Architecture:** Keep Python analysis on the current `ast` path. Add a small language-facts contract plus Tree-sitter adapters that return normalized facts into a new top-level `language_facts` graph field. Execution Flow traversal remains Python-only.

**Tech Stack:** Python 3.11+, `uv`, `unittest`, `tree-sitter`, `tree-sitter-javascript`, `tree-sitter-typescript`, `tree-sitter-go`, `tree-sitter-rust`, React/TypeScript viewer type definitions.

## Global Constraints

- Preserve `avt analyze` as the only analyzer command.
- Do not replace the current Python `ast` analyzer.
- Do not add JS/TS/Go/Rust call graphs, route discovery, or framework semantics.
- Warnings must not include source snippets or secret-looking literal values.
- Use official Tree-sitter grammar wheels, not `tree-sitter-language-pack`.
- `language_facts` must be separate from Execution Flow nodes and edges.
- Unsupported files are ignored.
- Parser failures become warnings and do not abort analysis.

---

## File Structure

- Modify: `packages/analyzer/pyproject.toml`
  - Add official Tree-sitter runtime and grammar-wheel dependencies.
- Modify: `packages/analyzer/src/avt_analyzer/schema.py`
  - Add `LanguageId`, language fact TypedDicts, and `language_facts` on `ExecutionFlowGraph`.
- Modify: `apps/viewer/src/graph.ts`
  - Add TypeScript graph contract fields so viewer accepts `language_facts`.
- Modify: `packages/analyzer/src/avt_analyzer/graph.py`
  - Initialize `language_facts` to `[]` and accept optional facts in graph construction.
- Modify: `packages/analyzer/src/avt_analyzer/scanner.py`
  - Add deterministic source scanning for supported Tree-sitter extensions while keeping `scan_python_project()` behavior intact.
- Create: `packages/analyzer/src/avt_analyzer/language_facts.py`
  - Own Tree-sitter parser registry, normalized extraction, warnings.
- Modify: `packages/analyzer/src/avt_analyzer/cli.py`
  - Wire language facts into `avt analyze`; reject non-Python manual entries clearly.
- Modify: `packages/analyzer/tests/test_graph_contract.py`
  - Extend graph contract for `language_facts`.
- Create: `packages/analyzer/tests/test_language_facts.py`
  - Focused Tree-sitter baseline tests.
- Modify: `README.md`, `packages/analyzer/README.md`, `docs/development.md`
  - Document Tree-sitter code-map baseline without claiming multi-language Execution Flows.

---

### Task 1: Graph Contract and Dependencies

**Files:**
- Modify: `packages/analyzer/pyproject.toml`
- Modify: `packages/analyzer/src/avt_analyzer/schema.py`
- Modify: `packages/analyzer/src/avt_analyzer/graph.py`
- Modify: `apps/viewer/src/graph.ts`
- Modify: `packages/analyzer/tests/test_graph_contract.py`

**Interfaces:**
- Consumes: existing `ExecutionFlowGraph` contract.
- Produces: `language_facts` top-level graph field and shared language fact shapes.

- [ ] **Step 1: Write failing graph contract test**

In `packages/analyzer/tests/test_graph_contract.py`, update `_assert_graph_contract()` expected top-level keys and add language fact validation before warning validation:

```python
def _assert_graph_contract(testcase: unittest.TestCase, graph: dict[str, Any]) -> None:
    testcase.assertEqual(set(graph), {"metadata", "entry_points", "flows", "nodes", "edges", "markers", "warnings", "language_facts"})
    testcase.assertIn("schema_version", graph["metadata"])
    testcase.assertIn("analyzer_version", graph["metadata"])
    testcase.assertIn("project_name", graph["metadata"])

    node_ids = _assert_unique_ids(testcase, graph["nodes"])
    edge_ids = _assert_unique_ids(testcase, graph["edges"])
    marker_ids = _assert_unique_ids(testcase, graph["markers"])
    entry_ids = _assert_unique_ids(testcase, graph["entry_points"])

    testcase.assertEqual([node["id"] for node in graph["nodes"]], sorted(node_ids))
    testcase.assertEqual([edge["id"] for edge in graph["edges"]], sorted(edge_ids))
    testcase.assertEqual([marker["id"] for marker in graph["markers"]], sorted(marker_ids))
    testcase.assertEqual([entry["id"] for entry in graph["entry_points"]], sorted(entry_ids))

    for fact in graph["language_facts"]:
        testcase.assertIn(fact["language"], {"javascript", "typescript", "tsx", "go", "rust"})
        testcase.assertIn("path", fact)
        testcase.assertIsInstance(fact["definitions"], list)
        testcase.assertIsInstance(fact["imports"], list)
        testcase.assertIsInstance(fact["warnings"], list)
        for definition in fact["definitions"]:
            testcase.assertIn(definition["kind"], {"function", "method", "class", "type", "struct", "interface"})
            testcase.assertIn("name", definition)
            _assert_location_contract(testcase, definition["location"])
        for import_fact in fact["imports"]:
            testcase.assertIn("module", import_fact)
            _assert_location_contract(testcase, import_fact["location"])
        for warning in fact["warnings"]:
            testcase.assertIn("code", warning)
            testcase.assertIn("message", warning)
            if "location" in warning:
                _assert_location_contract(testcase, warning["location"])

    for node in graph["nodes"]:
        testcase.assertIn(node["kind"], {"project", "module", "class", "function", "method", "external"})
        testcase.assertIn("label", node)
        if "parent_id" in node:
            testcase.assertIn(node["parent_id"], node_ids)

    for edge in graph["edges"]:
        testcase.assertIn(edge["kind"], {"call", "await", "external_interaction", "inheritance", "override"})
        testcase.assertIn(edge["certainty"], {"confirmed", "uncertain", "rejected"})
        testcase.assertIn(edge["source"], node_ids)
        testcase.assertIn(edge["target"], node_ids)
        _assert_evidence_contract(testcase, edge["evidence"])

    for marker in graph["markers"]:
        testcase.assertIn(marker["kind"], {"conditional", "raise", "return", "async", "loop"})
        testcase.assertTrue("node_id" in marker or "edge_id" in marker)
        if "node_id" in marker:
            testcase.assertIn(marker["node_id"], node_ids)
        if "edge_id" in marker:
            testcase.assertIn(marker["edge_id"], edge_ids)
        _assert_evidence_contract(testcase, marker["evidence"])

    for entry in graph["entry_points"]:
        testcase.assertIn(entry["kind"], {"web_route", "framework_hook", "cli_command", "script", "manual"})
        testcase.assertIn(entry["node_id"], node_ids)
        if "route_path" in entry:
            testcase.assertIsInstance(entry["route_path"], str)
        if "http_methods" in entry:
            testcase.assertIsInstance(entry["http_methods"], list)
            testcase.assertTrue(all(isinstance(method, str) for method in entry["http_methods"]))
        _assert_evidence_contract(testcase, entry["evidence"])

    for flow in graph["flows"]:
        testcase.assertIn(flow["entry_point_id"], entry_ids)
        testcase.assertEqual(flow["node_ids"], sorted(flow["node_ids"]))
        testcase.assertEqual(flow["edge_ids"], sorted(flow["edge_ids"]))
        testcase.assertEqual(flow["marker_ids"], sorted(flow["marker_ids"]))
        testcase.assertTrue(set(flow["node_ids"]).issubset(node_ids))
        testcase.assertTrue(set(flow["edge_ids"]).issubset(edge_ids))
        testcase.assertTrue(set(flow["marker_ids"]).issubset(marker_ids))

    for warning in graph["warnings"]:
        testcase.assertIn("code", warning)
        testcase.assertIn("message", warning)
        if "location" in warning:
            _assert_location_contract(testcase, warning["location"])
```

- [ ] **Step 2: Run contract test to verify it fails**

Run:

```bash
uv run --project packages/analyzer python -m unittest packages/analyzer/tests/test_graph_contract.py
```

Expected: FAIL because existing graphs do not contain `language_facts`.

- [ ] **Step 3: Add dependencies**

In `packages/analyzer/pyproject.toml`, replace dependencies:

```toml
dependencies = [
    "tree-sitter>=0.25,<0.26",
    "tree-sitter-go>=0.25,<0.26",
    "tree-sitter-javascript>=0.25,<0.26",
    "tree-sitter-rust>=0.24,<0.25",
    "tree-sitter-typescript>=0.23,<0.24",
]
```

- [ ] **Step 4: Add Python schema types**

In `packages/analyzer/src/avt_analyzer/schema.py`, add these aliases and TypedDicts after `FlowMarkerKind`:

```python
LanguageId = Literal["javascript", "typescript", "tsx", "go", "rust"]
LanguageDefinitionKind = Literal["function", "method", "class", "type", "struct", "interface"]


class LanguageDefinition(TypedDict):
    kind: LanguageDefinitionKind
    name: str
    location: SourceLocation
    qualified_name: NotRequired[str]


class LanguageImport(TypedDict):
    module: str
    location: SourceLocation
    name: NotRequired[str]


class LanguageFact(TypedDict):
    path: str
    language: LanguageId
    definitions: list[LanguageDefinition]
    imports: list[LanguageImport]
    warnings: list[GraphWarning]
```

Then add to `ExecutionFlowGraph`:

```python
class ExecutionFlowGraph(TypedDict):
    metadata: GraphMetadata
    entry_points: list[EntryPoint]
    flows: list[ExecutionFlow]
    nodes: list[GraphNode]
    edges: list[GraphEdge]
    markers: list[FlowMarker]
    warnings: list[GraphWarning]
    language_facts: list[LanguageFact]
```

- [ ] **Step 5: Initialize graph field**

In `packages/analyzer/src/avt_analyzer/graph.py`, update imports:

```python
from avt_analyzer.schema import ExecutionFlowGraph, GraphNode, LanguageFact
```

In `build_empty_graph()`, add:

```python
        "language_facts": [],
```

Update `build_discovery_graph()` signature and body:

```python
def build_discovery_graph(
    *,
    project_name: str,
    analyzer_version: str,
    discovery: DiscoveryResult,
    include_timestamp: bool = True,
    max_depth: int = 6,
    language_facts: tuple[LanguageFact, ...] = (),
) -> ExecutionFlowGraph:
```

Before `return graph`, add:

```python
    graph["language_facts"] = list(language_facts)
```

- [ ] **Step 6: Add viewer graph types**

In `apps/viewer/src/graph.ts`, add after `GraphWarning`:

```ts
export type LanguageId = 'javascript' | 'typescript' | 'tsx' | 'go' | 'rust';
export type LanguageDefinitionKind = 'function' | 'method' | 'class' | 'type' | 'struct' | 'interface';

export interface LanguageDefinition {
  kind: LanguageDefinitionKind;
  name: string;
  location: SourceLocation;
  qualified_name?: string;
}

export interface LanguageImport {
  module: string;
  location: SourceLocation;
  name?: string;
}

export interface LanguageFact {
  path: string;
  language: LanguageId;
  definitions: LanguageDefinition[];
  imports: LanguageImport[];
  warnings: GraphWarning[];
}
```

Add `language_facts` to `ExecutionFlowGraph`:

```ts
export interface ExecutionFlowGraph {
  metadata: GraphMetadata;
  entry_points: EntryPoint[];
  flows: ExecutionFlow[];
  nodes: GraphNode[];
  edges: GraphEdge[];
  markers: FlowMarker[];
  warnings: GraphWarning[];
  language_facts: LanguageFact[];
}
```

Update `isExecutionFlowGraph()` to require the field:

```ts
      Array.isArray(graph.warnings) &&
      Array.isArray(graph.language_facts),
```

- [ ] **Step 7: Update sample fixture**

In `packages/analyzer/tests/fixtures/sample_graph.json`, add an empty top-level field before `warnings`:

```json
  "language_facts": [],
```

Keep JSON valid and sorted only if existing fixture ordering is already sorted.

- [ ] **Step 8: Run contract test to verify it passes**

Run:

```bash
uv run --project packages/analyzer python -m unittest packages/analyzer/tests/test_graph_contract.py
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/analyzer/pyproject.toml packages/analyzer/src/avt_analyzer/schema.py packages/analyzer/src/avt_analyzer/graph.py apps/viewer/src/graph.ts packages/analyzer/tests/test_graph_contract.py packages/analyzer/tests/fixtures/sample_graph.json
git commit -m "feat: add language facts graph contract"
```

---

### Task 2: Deterministic Source Scanning

**Files:**
- Modify: `packages/analyzer/src/avt_analyzer/scanner.py`
- Create: `packages/analyzer/tests/test_language_facts.py`

**Interfaces:**
- Consumes: existing `_is_excluded(parts, include_tests=...)` behavior.
- Produces: `SourceFile`, `scan_supported_source_files(project_path: Path, include_tests: bool = False) -> tuple[SourceFile, ...]`.

- [ ] **Step 1: Write failing scan test**

Create `packages/analyzer/tests/test_language_facts.py`:

```python
from __future__ import annotations

import textwrap
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from avt_analyzer.scanner import scan_supported_source_files


class LanguageFactTests(unittest.TestCase):
    def test_scans_supported_non_python_files_deterministically(self) -> None:
        with TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "app.py").write_text("def main():\n    pass\n", encoding="utf-8")
            (root / "web.ts").write_text("export function route() {}\n", encoding="utf-8")
            (root / "cmd.go").write_text("package main\nfunc main() {}\n", encoding="utf-8")
            (root / "lib.rs").write_text("pub fn run() {}\n", encoding="utf-8")
            (root / "node_modules").mkdir()
            (root / "node_modules" / "skip.ts").write_text("export function skip() {}\n", encoding="utf-8")
            (root / "tests").mkdir()
            (root / "tests" / "skip.ts").write_text("export function testSkip() {}\n", encoding="utf-8")

            default_scan = scan_supported_source_files(root)
            include_tests_scan = scan_supported_source_files(root, include_tests=True)

        self.assertEqual([file.relative_path for file in default_scan], ["cmd.go", "lib.rs", "web.ts"])
        self.assertEqual([file.relative_path for file in include_tests_scan], ["cmd.go", "lib.rs", "tests/skip.ts", "web.ts"])
        self.assertEqual([file.language for file in default_scan], ["go", "rust", "typescript"])


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
uv run --project packages/analyzer python -m unittest packages/analyzer/tests/test_language_facts.py
```

Expected: FAIL importing `scan_supported_source_files`.

- [ ] **Step 3: Implement source scanning**

In `packages/analyzer/src/avt_analyzer/scanner.py`, update imports:

```python
from typing import Literal
```

Add after `SCRIPT_DIR_NAMES`:

```python
SourceLanguage = Literal["javascript", "typescript", "tsx", "go", "rust"]
SUPPORTED_SOURCE_EXTENSIONS: dict[str, SourceLanguage] = {
    ".js": "javascript",
    ".jsx": "javascript",
    ".ts": "typescript",
    ".tsx": "tsx",
    ".go": "go",
    ".rs": "rust",
}
```

Add dataclass after `PythonFile`:

```python
@dataclass(frozen=True)
class SourceFile:
    """A supported non-Python source file inside an analyzed project."""

    path: Path
    relative_path: str
    source: str
    language: SourceLanguage
```

Add function after `scan_python_project()`:

```python
def scan_supported_source_files(project_path: Path, *, include_tests: bool = False) -> tuple[SourceFile, ...]:
    """Find supported non-Python source files deterministically."""

    files: list[SourceFile] = []
    candidates = (
        path
        for path in project_path.rglob("*")
        if path.is_file() and path.suffix in SUPPORTED_SOURCE_EXTENSIONS
    )
    for path in sorted(candidates, key=lambda item: item.relative_to(project_path).as_posix()):
        relative = path.relative_to(project_path)
        relative_path = relative.as_posix()
        if _is_excluded(relative.parts, include_tests=include_tests):
            continue
        try:
            source = path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue
        files.append(
            SourceFile(
                path=path,
                relative_path=relative_path,
                source=source,
                language=SUPPORTED_SOURCE_EXTENSIONS[path.suffix],
            )
        )
    return tuple(files)
```

Do not change `scan_python_project()`.

- [ ] **Step 4: Run scan test to verify it passes**

Run:

```bash
uv run --project packages/analyzer python -m unittest packages/analyzer/tests/test_language_facts.py
```

Expected: PASS.

- [ ] **Step 5: Run existing scanner tests**

Run:

```bash
uv run --project packages/analyzer python -m unittest packages/analyzer/tests/test_analyzer_discovery.py
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/analyzer/src/avt_analyzer/scanner.py packages/analyzer/tests/test_language_facts.py
git commit -m "feat: scan supported source files"
```

---

### Task 3: Tree-sitter Fact Extraction

**Files:**
- Create: `packages/analyzer/src/avt_analyzer/language_facts.py`
- Modify: `packages/analyzer/tests/test_language_facts.py`

**Interfaces:**
- Consumes: `SourceFile` from `avt_analyzer.scanner`.
- Produces: `extract_language_facts(files: tuple[SourceFile, ...]) -> tuple[LanguageFact, ...]`.

- [ ] **Step 1: Add failing extraction tests**

Append to `LanguageFactTests` in `packages/analyzer/tests/test_language_facts.py`:

```python
    def test_extracts_backend_trio_language_facts(self) -> None:
        with TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "web.ts").write_text(
                textwrap.dedent(
                    """
                    import { Router } from 'express';
                    export class UsersController {
                      listUsers() { return []; }
                    }
                    export function makeRouter() { return Router(); }
                    """
                ).lstrip(),
                encoding="utf-8",
            )
            (root / "cmd.go").write_text(
                textwrap.dedent(
                    """
                    package main
                    import "fmt"
                    type Server struct{}
                    func (s Server) Start() {}
                    func main() { fmt.Println("ok") }
                    """
                ).lstrip(),
                encoding="utf-8",
            )
            (root / "lib.rs").write_text(
                textwrap.dedent(
                    """
                    use std::fs;
                    struct Worker;
                    impl Worker { fn run(&self) {} }
                    pub fn boot() { let _ = fs::read_to_string("x"); }
                    """
                ).lstrip(),
                encoding="utf-8",
            )

            facts = extract_language_facts(scan_supported_source_files(root))

        by_path = {fact["path"]: fact for fact in facts}
        self.assertEqual(set(by_path), {"cmd.go", "lib.rs", "web.ts"})
        self.assertEqual(by_path["web.ts"]["language"], "typescript")
        self.assertIn(("class", "UsersController"), _definition_pairs(by_path["web.ts"]))
        self.assertIn(("function", "makeRouter"), _definition_pairs(by_path["web.ts"]))
        self.assertIn("express", {item["module"] for item in by_path["web.ts"]["imports"]})
        self.assertIn(("struct", "Server"), _definition_pairs(by_path["cmd.go"]))
        self.assertIn(("function", "main"), _definition_pairs(by_path["cmd.go"]))
        self.assertIn("fmt", {item["module"] for item in by_path["cmd.go"]["imports"]})
        self.assertIn(("struct", "Worker"), _definition_pairs(by_path["lib.rs"]))
        self.assertIn(("function", "boot"), _definition_pairs(by_path["lib.rs"]))
        self.assertIn("std::fs", {item["module"] for item in by_path["lib.rs"]["imports"]})

    def test_parser_error_becomes_file_warning(self) -> None:
        with TemporaryDirectory() as temp:
            root = Path(temp)
            bad = root / "broken.ts"
            bad.write_bytes(b"\xff\xfe\x00")

            # scanner skips unreadable UTF-8 files; direct SourceFile covers adapter error path.
            from avt_analyzer.scanner import SourceFile

            facts = extract_language_facts((SourceFile(path=bad, relative_path="broken.ts", source="function {", language="typescript"),))

        self.assertEqual(facts[0]["path"], "broken.ts")
        self.assertTrue(any(warning["code"] == "tree_sitter_parse_error" for warning in facts[0]["warnings"]))
```

Add helpers/imports near the top:

```python
from avt_analyzer.language_facts import extract_language_facts


def _definition_pairs(fact: dict) -> set[tuple[str, str]]:
    return {(definition["kind"], definition["name"]) for definition in fact["definitions"]}
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
uv run --project packages/analyzer python -m unittest packages/analyzer/tests/test_language_facts.py
```

Expected: FAIL importing `avt_analyzer.language_facts`.

- [ ] **Step 3: Implement minimal extractor**

Create `packages/analyzer/src/avt_analyzer/language_facts.py`:

```python
"""Tree-sitter-backed language fact extraction."""

from __future__ import annotations

from collections.abc import Iterable

from tree_sitter import Language, Node, Parser
import tree_sitter_go as tsgo
import tree_sitter_javascript as tsjavascript
import tree_sitter_rust as tsrust
import tree_sitter_typescript as tstypescript

from avt_analyzer.scanner import SourceFile, SourceLanguage
from avt_analyzer.schema import GraphWarning, LanguageFact, SourceLocation

_LANGUAGES: dict[SourceLanguage, Language] = {
    "javascript": Language(tsjavascript.language()),
    "typescript": Language(tstypescript.language_typescript()),
    "tsx": Language(tstypescript.language_tsx()),
    "go": Language(tsgo.language()),
    "rust": Language(tsrust.language()),
}


def extract_language_facts(files: tuple[SourceFile, ...]) -> tuple[LanguageFact, ...]:
    facts: list[LanguageFact] = []
    for file in files:
        facts.append(_extract_file(file))
    return tuple(sorted(facts, key=lambda fact: fact["path"]))


def _extract_file(file: SourceFile) -> LanguageFact:
    warnings: list[GraphWarning] = []
    try:
        parser = Parser(_LANGUAGES[file.language])
        tree = parser.parse(file.source.encode("utf-8"))
        root = tree.root_node
    except Exception as exc:  # pragma: no cover - exact native failure type is platform-specific
        return {
            "path": file.relative_path,
            "language": file.language,
            "definitions": [],
            "imports": [],
            "warnings": [_warning(file.relative_path, "tree_sitter_parser_unavailable", f"Could not parse {file.language} file: {type(exc).__name__}")],
        }

    if root.has_error:
        warnings.append(_warning(file.relative_path, "tree_sitter_parse_error", f"Could not fully parse {file.language} file"))

    return {
        "path": file.relative_path,
        "language": file.language,
        "definitions": _definitions(file, root),
        "imports": _imports(file, root),
        "warnings": warnings,
    }


def _definitions(file: SourceFile, root: Node) -> list[dict]:
    found: list[dict] = []
    for node in _walk(root):
        name_node: Node | None = None
        kind: str | None = None
        if file.language in {"javascript", "typescript", "tsx"}:
            if node.type in {"function_declaration", "method_definition"}:
                kind = "method" if node.type == "method_definition" else "function"
                name_node = node.child_by_field_name("name")
            elif node.type == "class_declaration":
                kind = "class"
                name_node = node.child_by_field_name("name")
            elif node.type == "interface_declaration":
                kind = "interface"
                name_node = node.child_by_field_name("name")
            elif node.type == "type_alias_declaration":
                kind = "type"
                name_node = node.child_by_field_name("name")
        elif file.language == "go":
            if node.type in {"function_declaration", "method_declaration"}:
                kind = "method" if node.type == "method_declaration" else "function"
                name_node = node.child_by_field_name("name")
            elif node.type == "type_declaration":
                kind = "struct"
                name_node = _first_descendant_type(node, "type_identifier")
        elif file.language == "rust":
            if node.type == "function_item":
                kind = "function"
                name_node = node.child_by_field_name("name")
            elif node.type == "struct_item":
                kind = "struct"
                name_node = node.child_by_field_name("name")
            elif node.type == "trait_item":
                kind = "interface"
                name_node = node.child_by_field_name("name")
            elif node.type == "type_item":
                kind = "type"
                name_node = node.child_by_field_name("name")
        if kind is None or name_node is None:
            continue
        name = _node_text(file.source, name_node)
        if not name:
            continue
        found.append({"kind": kind, "name": name, "location": _location(file.relative_path, node)})
    return sorted(found, key=lambda item: (item["location"]["line"], item["location"]["column"], item["kind"], item["name"]))


def _imports(file: SourceFile, root: Node) -> list[dict]:
    found: list[dict] = []
    for node in _walk(root):
        module: str | None = None
        if file.language in {"javascript", "typescript", "tsx"} and node.type == "import_statement":
            module = _strip_quotes(_last_string_child(file.source, node))
        elif file.language == "go" and node.type == "import_spec":
            module = _strip_quotes(_first_descendant_text(file.source, node, "interpreted_string_literal"))
        elif file.language == "rust" and node.type == "use_declaration":
            module = _rust_use_path(file.source, node)
        if module:
            found.append({"module": module, "location": _location(file.relative_path, node)})
    return sorted(found, key=lambda item: (item["location"]["line"], item["module"]))


def _walk(node: Node) -> Iterable[Node]:
    yield node
    for child in node.children:
        yield from _walk(child)


def _first_descendant_type(node: Node, node_type: str) -> Node | None:
    for child in _walk(node):
        if child.type == node_type:
            return child
    return None


def _first_descendant_text(source: str, node: Node, node_type: str) -> str | None:
    found = _first_descendant_type(node, node_type)
    return _node_text(source, found) if found is not None else None


def _last_string_child(source: str, node: Node) -> str | None:
    matches = [_node_text(source, child) for child in _walk(node) if child.type == "string"]
    return matches[-1] if matches else None


def _rust_use_path(source: str, node: Node) -> str | None:
    text = _node_text(source, node).strip()
    if not text.startswith("use "):
        return None
    return text[4:].rstrip(";").strip() or None


def _node_text(source: str, node: Node | None) -> str:
    if node is None:
        return ""
    return source.encode("utf-8")[node.start_byte:node.end_byte].decode("utf-8", errors="ignore")


def _strip_quotes(value: str | None) -> str | None:
    if value is None:
        return None
    value = value.strip()
    if len(value) >= 2 and value[0] in {'"', "'", "`"} and value[-1] == value[0]:
        return value[1:-1]
    return value or None


def _location(path: str, node: Node) -> SourceLocation:
    return {"path": path, "line": node.start_point[0] + 1, "column": node.start_point[1]}


def _warning(path: str, code: str, message: str) -> GraphWarning:
    return {"code": code, "message": message, "location": {"path": path, "line": 1, "column": 0}}
```

- [ ] **Step 4: Run extraction tests to verify they pass**

Run:

```bash
uv run --project packages/analyzer python -m unittest packages/analyzer/tests/test_language_facts.py
```

Expected: PASS. If a grammar node name differs, inspect only that fixture's parsed node types and adjust the minimal extractor; do not broaden into framework analysis.

- [ ] **Step 5: Commit**

```bash
git add packages/analyzer/src/avt_analyzer/language_facts.py packages/analyzer/tests/test_language_facts.py
git commit -m "feat: extract tree-sitter language facts"
```

---

### Task 4: CLI Integration and Manual Entry Guard

**Files:**
- Modify: `packages/analyzer/src/avt_analyzer/cli.py`
- Modify: `packages/analyzer/tests/test_language_facts.py`

**Interfaces:**
- Consumes: `scan_supported_source_files()` and `extract_language_facts()`.
- Produces: `language_facts` in CLI graph output and warning for non-Python manual entries.

- [ ] **Step 1: Add failing CLI integration tests**

Append to `LanguageFactTests` in `packages/analyzer/tests/test_language_facts.py` and add imports `json`, `subprocess`, `sys`:

```python
    def test_cli_writes_language_facts_for_mixed_repo_without_changing_python_flows(self) -> None:
        with TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "app.py").write_text(
                textwrap.dedent(
                    """
                    @app.get('/health')
                    def health():
                        return {'ok': True}
                    """
                ).lstrip(),
                encoding="utf-8",
            )
            (root / "service.ts").write_text("import { Router } from 'express';\nexport function makeRouter() { return Router(); }\n", encoding="utf-8")
            out = root / "graph.json"

            subprocess.run(
                [sys.executable, "-m", "avt_analyzer.cli", "analyze", str(root), "--no-timestamp", "--out", str(out)],
                check=True,
                capture_output=True,
                text=True,
            )
            graph = json.loads(out.read_text(encoding="utf-8"))

        self.assertEqual(len(graph["entry_points"]), 1)
        self.assertEqual(len(graph["flows"]), 1)
        self.assertEqual(graph["language_facts"][0]["path"], "service.ts")
        self.assertIn(("function", "makeRouter"), _definition_pairs(graph["language_facts"][0]))

    def test_cli_rejects_non_python_manual_entry_with_warning(self) -> None:
        with TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "service.ts").write_text("export function makeRouter() { return null; }\n", encoding="utf-8")
            out = root / "graph.json"

            subprocess.run(
                [sys.executable, "-m", "avt_analyzer.cli", "analyze", str(root), "--entry", "service.ts:makeRouter", "--no-timestamp", "--out", str(out)],
                check=True,
                capture_output=True,
                text=True,
            )
            graph = json.loads(out.read_text(encoding="utf-8"))

        self.assertEqual(graph["entry_points"], [])
        self.assertTrue(any(warning["code"] == "manual_entry_non_python" for warning in graph["warnings"]))
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
uv run --project packages/analyzer python -m unittest packages/analyzer/tests/test_language_facts.py
```

Expected: FAIL because CLI does not write `language_facts` or manual-entry warning.

- [ ] **Step 3: Wire CLI**

In `packages/analyzer/src/avt_analyzer/cli.py`, update imports:

```python
from avt_analyzer.language_facts import extract_language_facts
from avt_analyzer.scanner import scan_python_project, scan_supported_source_files
```

Add helper near `_build_summary()`:

```python
def _split_manual_entries(entries: list[str]) -> tuple[list[str], list[dict]]:
    python_entries: list[str] = []
    warnings: list[dict] = []
    for entry in entries:
        path = entry.split(":", 1)[0]
        if not path.endswith(".py"):
            warnings.append(
                {
                    "code": "manual_entry_non_python",
                    "message": f"Manual Entry Point is Python-only in this slice: {path}",
                    "location": {"path": path, "line": 1, "column": 0},
                }
            )
            continue
        python_entries.append(entry)
    return python_entries, warnings
```

In `analyze_command()`, replace scan/discovery block lines with:

```python
    scan = scan_python_project(project_path, include_tests=args.include_tests)
    source_files = scan_supported_source_files(project_path, include_tests=args.include_tests)
    language_facts = extract_language_facts(source_files)
    manual_entries, manual_warnings = _split_manual_entries(args.entry)
    base_discovery = discover_entry_points(scan)
    guide_warnings = []
    guide_entries = ()
    if args.guide is not None:
        guide_result = load_guide_entries(args.guide, base_discovery)
        guide_entries = guide_result.entries
        guide_warnings = list(guide_result.warnings)
    discovery = discover_entry_points(scan, manual_entries=[*manual_entries, *guide_entries])
```

Update `build_discovery_graph()` call:

```python
        language_facts=language_facts,
```

Update warning merge:

```python
    language_warnings = [warning for fact in language_facts for warning in fact["warnings"]]
    graph["warnings"] = [*scan.warnings, *scan_safety(scan), *manual_warnings, *guide_warnings, *language_warnings, *graph["warnings"]]
```

- [ ] **Step 4: Run CLI integration tests**

Run:

```bash
uv run --project packages/analyzer python -m unittest packages/analyzer/tests/test_language_facts.py
```

Expected: PASS.

- [ ] **Step 5: Run analyzer contract tests**

Run:

```bash
uv run --project packages/analyzer python -m unittest packages/analyzer/tests/test_graph_contract.py packages/analyzer/tests/test_analyzer_discovery.py
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/analyzer/src/avt_analyzer/cli.py packages/analyzer/tests/test_language_facts.py
git commit -m "feat: include language facts in analysis output"
```

---

### Task 5: Documentation and Final Verification

**Files:**
- Modify: `README.md`
- Modify: `packages/analyzer/README.md`
- Modify: `docs/development.md`

**Interfaces:**
- Consumes: implemented `language_facts` behavior.
- Produces: user-visible docs that say Tree-sitter code-map baseline, not multi-language Execution Flows.

- [ ] **Step 1: Update README support language**

In `README.md`, update current status implemented capabilities with one bullet:

```markdown
- Tree-sitter code-map baseline for JavaScript/TypeScript, Go, and Rust via `language_facts`.
```

Update limitations to include:

```markdown
- JavaScript/TypeScript, Go, and Rust support is code-map context only; Execution Flow traversal remains Python-only;
```

Keep the existing warning that broad multi-language support is future work.

- [ ] **Step 2: Update analyzer README CLI behavior**

In `packages/analyzer/README.md`, add a short section after the graph generation examples:

```markdown
### Tree-sitter code-map baseline

`avt analyze` also parses supported JavaScript/TypeScript, Go, and Rust files into top-level `language_facts`.
These facts include file language, definitions, imports, source locations, and parser warnings.
They do not create non-Python Execution Flows, route discovery, or framework semantics.
Manual Entry Points remain Python-only in this slice.
```

- [ ] **Step 3: Update development verification docs**

In `docs/development.md`, update analyzer verification commands:

```sh
uv run --project packages/analyzer python -m unittest discover packages/analyzer/tests
uv run --project packages/analyzer python -m unittest packages/analyzer/tests/test_language_facts.py
uv run --project packages/analyzer avt analyze . --no-timestamp --out /tmp/avt-graph.json
python -m json.tool /tmp/avt-graph.json >/dev/null
uv run --project packages/analyzer avt analyze . --list-entrypoints --no-timestamp
```

- [ ] **Step 4: Run analyzer test suite**

Run:

```bash
uv run --project packages/analyzer python -m unittest discover packages/analyzer/tests
```

Expected: PASS.

- [ ] **Step 5: Run analyzer smoke command**

Run:

```bash
uv run --project packages/analyzer avt analyze . --no-timestamp --out /tmp/avt-graph.json
python -m json.tool /tmp/avt-graph.json >/dev/null
```

Expected: analyzer exits 0; JSON validation exits 0.

- [ ] **Step 6: Run viewer build contract check**

Run:

```bash
npm run build
```

Working directory: `apps/viewer`

Expected: PASS. This validates TypeScript graph type changes.

- [ ] **Step 7: Ponytail pass**

Check the final diff for over-building:

- Delete any framework-specific JS/TS/Go/Rust route logic.
- Delete any non-Python graph edges/nodes manufactured from Tree-sitter facts.
- Keep only the parser registry, normalized facts, warning path, docs, and tests.
- If extractor logic grew beyond obvious declarations/imports, cut it back.

- [ ] **Step 8: Commit docs and cleanup**

```bash
git add README.md packages/analyzer/README.md docs/development.md
git commit -m "docs: document tree-sitter code-map baseline"
```

- [ ] **Step 9: Final status check**

Run:

```bash
git status --short
```

Expected: no output.

Final response must include:

```text
Gate: validated unittest discover packages/analyzer/tests; analyzer smoke JSON; viewer npm run build; ponytail pass kept parser baseline only.
```
