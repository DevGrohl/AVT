# AVT Analyzer

Python package and CLI for generating AVT Execution Flow Graphs.

Current command shape:

```sh
avt analyze <path> --out graph.json
avt analyze <path> --list-entrypoints
avt analyze <path> --entry path.py:qualified.name
```

Implemented Phase 1 foundations:

- deterministic Python file scanning;
- default exclusions for tests, migrations, caches, build output, virtualenvs, and vendor directories;
- `--include-tests` opt-in for test files;
- parse/decode/read warnings in graph output;
- Entry Point discovery for common web route decorators, Click/Typer-style command decorators, `if __name__ == "__main__"`, shebangs, `__main__.py`, and `scripts/`, `bin/`, or `tools/` files;
- manual Entry Point selection with `--entry`;
- local call traversal from Entry Points up to `--max-depth`;
- confirmed `call` and `await` edges for same-module and imported local functions;
- basic `uncertain` edges when an unqualified call name ambiguously matches multiple local functions;
- reachable Flow Markers for async functions, conditionals, loops, raises, and returns;
- External Interaction nodes and edges for filesystem, subprocess/shell, HTTP/network, and database-ish calls;
- method call resolution for `self.method()`, directly instantiated locals, and type-hint-based locals;
- uncertain method edges when a type name ambiguously matches multiple local classes.

Analysis Overlay support:

```json
{
  "edge_resolutions": [
    {"edge_id": "edge:...", "certainty": "confirmed"},
    {"edge_id": "edge:...", "certainty": "rejected"}
  ]
}
```

Use `--overlay path` or place the file at `<project>/.avt/overlay.json`. Overlay resolutions apply only to uncertain edges.

The analyzer currently builds hierarchy/function nodes and first-pass Execution Flows. Safety/redaction and schema hardening come next.

This package is intentionally CLI/library-first. A backend API can wrap it later.
