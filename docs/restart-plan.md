# AVT Restart Plan

AVT is restarting as an Understanding Aid for developers trying to understand unfamiliar Python projects. Documentation Aid is a later capability; Phase 1 focuses on building the tool and producing trustworthy Execution Flow Graphs.

## Restart Phase 1 Scope

- Analyze local Python project directories only.
- Use Python `ast` first, behind replaceable internal parser boundaries.
- Produce static Execution Flow Graph JSON from the CLI.
- Provide a static/local web viewer for graph exploration.
- Package the analyzer as a reusable library so an API wrapper can be added later.

## Product Focus

- Primary view: Execution Flow first.
- Hierarchy is included as grouping/context, not the main product promise.
- One graph file may contain multiple Entry Points and flows.
- Global nodes are shared; flow-specific annotations carry reachability, certainty, depth, and marker context.

## Entry Points

Phase 1 discovers and supports manual selection of:

- Web routes using common decorator patterns, with explicit Flask/FastAPI support.
- Framework hooks that shape request or application lifecycle behavior, starting with FastAPI lifespan, middleware, and exception handlers.
- CLI commands using `if __name__ == "__main__"`, `argparse`, Click, and Typer.
- Executable scripts using `__main__`, shebangs, and common script directories such as `scripts/`, `bin/`, and `tools/`.

Manual Entry Points use:

```sh
avt analyze <path> --entry path.py:qualified.name
```

If no `--entry` is provided, the analyzer processes all discovered Entry Point candidates within depth limits.

## CLI Shape

```sh
avt analyze <path> --out graph.json
avt analyze <path> --list-entrypoints
```

Defaults:

- If `--out` is omitted, write `avt-graph.json` in the current directory.
- Print a human summary to stdout: files scanned, Entry Points found, flows analyzed, and warnings.
- Output ordering is deterministic.
- Graph metadata includes schema version, analyzer version, and generated timestamp.
- `--no-timestamp` supports reproducible output.
- `--overlay path` applies an Analysis Overlay, defaulting to `<project>/.avt/overlay.json` if present.

## Graph Contents

The Execution Flow Graph includes:

- Entry Points and Execution Flows.
- Function/method nodes identified by relative file path + qualified name.
- Entry Point identity as function identity + Entry Point kind.
- Hierarchy groups for project/module/class/function context.
- Calls, branches/outcomes, External Interactions, Uncertain Edges, and source locations.
- Edge evidence: source location plus detection reason code and human-readable label.
- Certainty enum: `confirmed`, `uncertain`, `rejected`.
- Relative paths only and project name only by default.

Phase 1 does not embed source snippets or full source code in graph JSON. It includes function signatures, type hints, and source locations.

## Flow Analysis Rules

- Follow local calls to a default depth limit with user override.
- Stop at third-party calls and mark meaningful ones as External Interactions.
- Meaningful External Interactions: HTTP/network, database, filesystem, and subprocess/shell.
- Mark functions with conditionals, raises, and return patterns; do not build a full control-flow graph.
- Flow Markers attach to functions and to edges only when AST position makes the context obvious.
- Mark async functions and await edges specially.
- Detect basic inheritance and likely overrides; do not attempt full dynamic dispatch.
- Resolve `self.method()`, directly instantiated locals, and type-hint-based method calls; ambiguous targets become Uncertain Edges.
- Imports help call resolution only and are not shown as graph edges in Phase 1.

## Exclusions and Safety

- Exclude tests by default; allow opt-in via CLI flag.
- Exclude common generated/cache/vendor directories: `.git`, `.venv`, `node_modules`, `dist`, `build`, `__pycache__`.
- Exclude migrations by default.
- Scan config structure only, never raw values.
- Include environment variable names, never values.
- Redact secret-looking values and emit warnings.
- Viewer shows global secret warning count plus affected file/location, never the value.
- AVT is not a security scanner; secret detection protects AVT output.
- Docstrings are excluded in Phase 1 and may be scanned later only with explicit opt-in.

## Analysis Overlay

- Uncertain Edges can be confirmed or rejected by the user.
- Resolutions are stored in a project-local Analysis Overlay.
- `.avt/overlay.json` is created only when the user resolves an Uncertain Edge.
- The viewer exports/downloads updated overlay files; the user places them at `.avt/overlay.json`.
- Analyzer and viewer can both apply overlays.
- Rejected edges are hidden by default but available via toggle.
- CLI overlay editing is later.

## Viewer

- Phase 1 uses a static/local viewer that loads Execution Flow Graph JSON.
- Viewer shows selected Execution Flow by default, not the whole-project graph.
- Viewer displays hierarchy groups, branch/outcome markers, External Interactions, and Uncertain Edges.
- Function signatures are shown; snippets are not shown by default.
- Editor integration is later via configurable protocol/command.

## Visualization Spike

Before choosing the graph library, create `spikes/visualization-libraries` and compare:

- Cytoscape.js
- D3.js
- React Flow

Use one shared sample graph with full Phase 1 shape and test:

- Rendering nodes/edges.
- Grouping/hierarchy support.
- Flow readability and layout quality.
- Interaction: click node, inspect metadata, filter uncertain edges.
- Performance at roughly 50/100, 200/500, and 1,000/3,000 nodes/edges.

## Architecture

- Monorepo structure:
  - `packages/analyzer`
  - `apps/viewer`
  - `spikes/visualization-libraries`
- Analyzer uses `uv`.
- Viewer uses Vite + React + TypeScript.

See ADRs:

- `docs/adr/0001-restart-as-monorepo.md`
- `docs/adr/0002-cli-static-json-before-api.md`
- `docs/adr/0003-use-react-flow-for-phase-1-viewer.md`

## Restart Phase 1 Success

First milestone: analyze one real Python repo and display one useful Execution Flow.

Useful means a Developer can explain the behavior path from Entry Point to major outcomes/interactions after using the viewer.

Confirmed calls should be correct when spot-checked. No percentage accuracy target yet.

## Phase 1 Readiness Status

As of 2026-06-05, Phase 1 is ready to transition into Phase 2 planning/implementation:

- RealtorCareersAPI is the primary realistic validation target.
- Static discovery finds web routes, framework hooks, CLI commands, scripts, route metadata, FastAPI router prefixes, and FastAPI dependency aliases.
- The viewer supports selected flows/groups, multiple diagram layouts, diagram handling controls, edge filters, and node/edge inspection.
- Analyzer tests and viewer builds are passing.

See `docs/phase2-llm-guide-plan.md` for the next phase.
