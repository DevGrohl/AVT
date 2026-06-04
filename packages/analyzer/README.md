# AVT Analyzer

Python package and CLI for generating AVT Execution Flow Graphs.

Initial command shape:

```sh
avt analyze <path> --out graph.json
avt analyze <path> --list-entrypoints
```

This package is intentionally CLI/library-first. A backend API can wrap it later.
