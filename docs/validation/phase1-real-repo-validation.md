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

### Viewer QA

See `docs/validation/viewer-real-graph-qa.md`.

Headless browser QA loaded the real AVT graph into the production viewer build, captured DOM and screenshot artifacts, and confirmed the page renders the AVT project, selected CLI Entry Point, and `analyze_command` flow content.

Artifacts:

- `docs/validation/artifacts/viewer-real-graph-dom.html`
- `docs/validation/artifacts/viewer-real-graph.png`

### Default discovery graph

Initial validation before argparse dispatch resolution:

- Files scanned: 9
- Entry Points found: 1
- Flows analyzed: 1
- Warnings: 0
- Nodes: 124
- Edges: 1
- External Interaction edges: 0
- Markers: 2

After T-13 argparse dispatch resolution:

- Files scanned: 9
- Entry Points found: 1
- Flows analyzed: 1
- Warnings: 0
- Nodes: 134
- Edges: 53
- External Interaction edges: 7
- Markers: 130

Discovered Entry Point:

- `cli_command: packages/analyzer/src/avt_analyzer/cli.py:main`

Spot-checked confirmed edges:

- `main -> build_parser`, reason `same_module_call`
- `main -> analyze_command`, reason `argparse_dispatch_call`
- `analyze_command -> scan_python_project`, reason `imported_function_call`
- `analyze_command -> discover_entry_points`, reason `imported_function_call`
- `analyze_command -> build_discovery_graph`, reason `imported_function_call`

Assessment: default discovery now produces a useful Execution Flow for the AVT analyzer CLI. Static argparse dispatch connects `args.func(args)` to `analyze_command` through `set_defaults(func=analyze_command)`.

### Manual `analyze_command` graph

Initial validation before source-root import resolution:

- Files scanned: 9
- Entry Points found: 2
- Flows analyzed: 2
- Warnings: 0
- Nodes: 128
- Edges: 5
- External Interaction edges: 4
- Markers: 14

After T-12 source-root import resolution:

- Files scanned: 9
- Entry Points found: 2
- Flows analyzed: 2
- Warnings: 0
- Nodes: 134
- Edges: 72
- External Interaction edges: 9
- Markers: 203

Spot-checked edges:

- `main -> build_parser`, reason `same_module_call`
- `analyze_command -> scan_python_project`, reason `imported_function_call`
- `analyze_command -> discover_entry_points`, reason `imported_function_call`
- `analyze_command -> build_discovery_graph`, reason `imported_function_call`
- `analyze_command -> scan_safety`, reason `imported_function_call`
- `analyze_command -> apply_overlay`, reason `imported_function_call`
- `analyze_command -> load_overlay`, reason `imported_function_call`
- `analyze_command -> project_path.exists`, reason `filesystem_method_call`
- `analyze_command -> args.out.parent.mkdir`, reason `filesystem_method_call`
- `analyze_command -> args.out.write_text`, reason `filesystem_method_call`

Assessment: the manual Entry Point now produces a useful first-pass Execution Flow across analyzer modules. A Developer can see that `analyze_command` scans files, discovers Entry Points, builds a graph, scans safety warnings, applies overlays, writes graph JSON, and emits filesystem interactions.

## Fix made during validation

Validation initially surfaced a false-positive External Interaction: `pathlib.Path` used as an `argparse` type was marked as filesystem interaction. The detector was tightened so constructors/path modules are not interactions by themselves; concrete filesystem methods such as `.exists()`, `.mkdir()`, `.read_text()`, and `.write_text()` still are.

## Gaps found

1. **Interactive viewer QA is still limited.**
   - Headless browser-load QA passes and screenshot/DOM artifacts exist.
   - The file picker, filter toggles, and click inspector should still receive interactive QA in a normal browser before user-facing release.

## Follow-ups

- Add automated browser tests once viewer behavior stabilizes.
- Exercise file picker, filters, and inspector manually in a normal browser before release.

## Verdict

Phase 1 has reached an initial end-to-end milestone:

- analyzer generates valid Execution Flow Graph JSON for a real Python repo;
- confirmed edges can be spot-checked;
- External Interactions are visible for a manual Entry Point;
- viewer builds and can load local graph JSON.

The Execution Flow is useful for the default discovered CLI Entry Point and crosses common `src/` package boundaries. The viewer production build can load and render the real graph in headless Chromium. The first Phase 1 milestone is validated at an initial end-to-end level; remaining viewer QA is interactive polish and automation.
