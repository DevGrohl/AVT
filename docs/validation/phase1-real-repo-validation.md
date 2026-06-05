# Phase 1 Real Repo Validation

Date: 2026-06-05

Target repository: this AVT repository at `/mnt/shared/Documents/Projects/AVT`

## Commands run

Default discovered Entry Points:

```sh
uv run --project packages/analyzer avt analyze . --no-timestamp --out /tmp/avt-self-graph.json
python -m json.tool /tmp/avt-self-graph.json >/dev/null
```

Manual analyzer command Entry Point:

```sh
uv run --project packages/analyzer avt analyze . \
  --entry packages/analyzer/src/avt_analyzer/cli.py:analyze_command \
  --no-timestamp \
  --out /tmp/avt-self-analyze-command-graph.json
python -m json.tool /tmp/avt-self-analyze-command-graph.json >/dev/null
```

Viewer build:

```sh
cd apps/viewer
npm run build
```

Analyzer tests:

```sh
uv run --project packages/analyzer python -m unittest discover packages/analyzer/tests
```

## Results

### Default discovery graph

- Files scanned: 9
- Entry Points found: 1
- Flows analyzed: 1
- Warnings: 0
- Nodes: 124
- Edges: 1
- External Interaction edges: 0
- Markers: 2

Discovered Entry Point:

- `cli_command: packages/analyzer/src/avt_analyzer/cli.py:main`

Spot-checked confirmed edge:

- `main -> build_parser`, reason `same_module_call`

Assessment: correct but shallow. The default CLI Entry Point dispatches through `argparse` and static analysis does not yet connect `args.func(args)` to `analyze_command`.

### Manual `analyze_command` graph

- Files scanned: 9
- Entry Points found: 2
- Flows analyzed: 2
- Warnings: 0
- Nodes: 128
- Edges: 5
- External Interaction edges: 4
- Markers: 14

Spot-checked edges:

- `main -> build_parser`, reason `same_module_call`
- `analyze_command -> project_path.exists`, reason `filesystem_method_call`
- `analyze_command -> candidate.exists`, reason `filesystem_method_call`
- `analyze_command -> args.out.parent.mkdir`, reason `filesystem_method_call`
- `analyze_command -> args.out.write_text`, reason `filesystem_method_call`

Assessment: the manual Entry Point produces a useful first-pass Execution Flow for the analyzer command. A Developer can see that `analyze_command` validates paths, checks overlay existence, writes graph JSON, and emits filesystem interactions.

## Fix made during validation

Validation initially surfaced a false-positive External Interaction: `pathlib.Path` used as an `argparse` type was marked as filesystem interaction. The detector was tightened so constructors/path modules are not interactions by themselves; concrete filesystem methods such as `.exists()`, `.mkdir()`, `.read_text()`, and `.write_text()` still are.

## Gaps found

1. **Argparse dynamic dispatch is not resolved.**
   - `main()` calls `args.func(args)`, which is configured by `set_defaults(func=analyze_command)`.
   - The analyzer does not yet connect this pattern.

2. **Import resolution does not understand source roots/package aliases.**
   - Imports such as `from avt_analyzer.scanner import scan_python_project` do not currently resolve to repo-relative modules under `packages/analyzer/src/avt_analyzer/` when analyzing from the monorepo root.
   - This limits traversal from `analyze_command` into scanner/discovery/graph modules.

3. **Viewer validation is build-level, not browser-inspected.**
   - `npm run build` passes.
   - The generated graph can be loaded through the viewer file picker, but this validation did not include a browser screenshot or manual visual QA record.

## Follow-ups

- Add a task for Python package/source-root import resolution.
- Add a task for argparse `set_defaults(func=...)` dispatch resolution.
- Add browser/manual QA notes after loading `/tmp/avt-self-analyze-command-graph.json` in the viewer.

## Verdict

Phase 1 has reached an initial end-to-end milestone:

- analyzer generates valid Execution Flow Graph JSON for a real Python repo;
- confirmed edges can be spot-checked;
- External Interactions are visible for a manual Entry Point;
- viewer builds and can load local graph JSON.

The Execution Flow is useful for manual Entry Points, but default discovery needs better framework/dynamic dispatch handling before the analyzer is reliably useful on the AVT repo without manual selection.
