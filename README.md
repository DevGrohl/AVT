# AVT

AVT is an **Architecture Visualizer Tool** for helping Developers understand unfamiliar Python projects through **Execution Flow Graphs**.

Phase 1 focuses on a local/static workflow:

1. Run the Python analyzer on a local project.
2. Generate Execution Flow Graph JSON.
3. Open the JSON in the static/local viewer.
4. Explore Entry Points, calls, External Interactions, Flow Markers, warnings, and uncertainty.

## Current status

Implemented Phase 1 baseline:

- Python analyzer CLI (`avt analyze`).
- Entry Point discovery and manual Entry Point selection.
- Static call traversal with certainty annotations.
- External Interaction detection.
- Flow Markers for meaningful static behavior evidence.
- Analysis Overlay loading for confirming/rejecting Uncertain Edges.
- Output-safety warnings for secret-looking literals and environment variable references.
- React Flow static/local viewer.
- End-to-end validation on this repository.

## Monorepo layout

```text
apps/viewer/                    Static/local React viewer
packages/analyzer/              Python analyzer package and avt CLI
docs/                           Project docs, ADRs, validation notes
spikes/visualization-libraries/ Visualization library comparison spike
```

## Quickstart

### 1. Generate a graph

From the repository root:

```sh
uv run --project packages/analyzer avt analyze . --no-timestamp --out /tmp/avt-graph.json
python -m json.tool /tmp/avt-graph.json >/dev/null
```

Folder output mode writes all parsing results:

```sh
uv run --project packages/analyzer avt analyze --input /absolute/path/to/repo --output avt-output
```

Useful variants:

```sh
# List discovered Entry Points only
uv run --project packages/analyzer avt analyze . --list-entrypoints

# Analyze a manual Entry Point
uv run --project packages/analyzer avt analyze . \
  --entry packages/analyzer/src/avt_analyzer/cli.py:analyze_command \
  --out /tmp/avt-graph.json

# Include tests in scanning
uv run --project packages/analyzer avt analyze . --include-tests --out /tmp/avt-graph.json
```

### 2. Run the viewer

```sh
cd apps/viewer
npm install
npm run dev
```

Open the printed local URL and use **Load graph JSON** to select the graph file.

For a production build:

```sh
cd apps/viewer
npm run build
npm run preview
```

## Analyzer CLI

Command:

```sh
avt analyze [path] [options]
```

Common usage through this monorepo:

```sh
uv run --project packages/analyzer avt analyze <path> [options]
```

Options summary:

| Option | Value | Description |
| --- | --- | --- |
| `<path>` | directory | Project directory to analyze. Must exist and be a directory. |
| `--out` | path | Output graph JSON file path. Defaults to `avt-graph.json` in the current directory when `--output` is omitted. |
| `--input` | absolute path | Absolute project directory to analyze; alternative to positional `<path>`. |
| `--output` | folder path | Folder for all parsing results: `graph.json`, `summary.json`, `warnings.json`, `entrypoints.json`. Cannot be combined with `--out`. |
| `--entry` | `path.py:qualified.name` | Manual Entry Point. May be passed multiple times. |
| `--list-entrypoints` | flag | Print discovered Entry Points and summary without writing graph JSON. |
| `--overlay` | path | Analysis Overlay JSON path. Defaults to `<project>/.avt/overlay.json` when present. |
| `--no-timestamp` | flag | Omit `metadata.generated_at` for reproducible output. |
| `--include-tests` | flag | Include tests that are excluded by default. |
| `--max-depth` | integer | Maximum call traversal depth. Defaults to `6`. |

See `packages/analyzer/README.md` for full analyzer documentation.

## Viewer

The viewer is a static/local web app. It does not require a backend and does not upload graph files.

Current UI includes:

- graph metadata summary;
- Entry Point selector;
- selected Execution Flow rendering with React Flow;
- diagram layout options: nested ownership map, swimlane hierarchy, outline + focused graph, layered flow, circular, and compact grid;
- diagram handling options for hierarchy context, External Interactions, and edge labels;
- hierarchy context nodes;
- node/edge inspector;
- Flow Marker details;
- External Interaction and certainty styling;
- filters for confirmed, uncertain, and rejected edges.

See `apps/viewer/README.md` for full viewer documentation.

## Execution Flow Graph contents

Graph JSON includes:

- `metadata` — schema/analyzer/project metadata;
- `entry_points` — discovered and manual Entry Points;
- `flows` — selected-flow node/edge/marker references;
- `nodes` — modules, classes, functions, methods, and External Interaction nodes;
- `edges` — calls, awaits, and External Interactions;
- `markers` — async, conditional, loop, raise, and return evidence;
- `warnings` — parse/read/safety/overlay warnings.

AVT uses relative paths and does not embed source snippets or full source code in graph JSON.

## Analysis Overlay

Analysis Overlay files let Developers resolve Uncertain Edges without changing source code.

Example:

```json
{
  "edge_resolutions": [
    {"edge_id": "edge:...", "certainty": "confirmed"},
    {"edge_id": "edge:...", "certainty": "rejected"}
  ]
}
```

Use an explicit overlay:

```sh
uv run --project packages/analyzer avt analyze . --overlay .avt/overlay.json
```

Or place it at:

```text
<project>/.avt/overlay.json
```

Overlay resolutions currently apply only to uncertain edges.

## Safety model

AVT is not a security scanner. The safety rules protect AVT output:

- secret-looking literal values are not emitted;
- warnings mention safe identifiers and source locations only;
- environment variable names may be included, values are not;
- docstrings are skipped during safety scanning;
- source snippets/full source are not embedded in graph JSON.

## Development verification

Analyzer:

```sh
uv run --project packages/analyzer python -m unittest discover packages/analyzer/tests
uv run --project packages/analyzer avt analyze . --no-timestamp --out /tmp/avt-graph.json
python -m json.tool /tmp/avt-graph.json >/dev/null
```

Viewer:

```sh
cd apps/viewer
npm install
npm run build
```

## Documentation

- `CONTEXT.md` — project language/glossary.
- `docs/restart-plan.md` — Phase 1 restart plan.
- `docs/phase2-llm-guide-plan.md` — Phase 2 LLM Guide plan.
- `docs/layout-overlay.md` — viewer layout overlay schema.
- `docs/future-lsp-multilanguage-plan.md` — future LSP-assisted multi-language architecture plan.
- `docs/development.md` — local development commands.
- `docs/adr/` — architecture decisions.
- `docs/validation/` — validation notes and QA artifacts, including Phase 2 Guide validation.
