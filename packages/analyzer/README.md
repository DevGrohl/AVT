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
- manual Entry Point selection with `--entry`.

The analyzer currently builds hierarchy/function nodes and one shallow Execution Flow per discovered Entry Point. Full call traversal comes next.

This package is intentionally CLI/library-first. A backend API can wrap it later.
