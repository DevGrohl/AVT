# Viewer Real Graph QA

Date: 2026-06-05

Graph under test: `/tmp/avt-self-graph.json`, generated from the AVT repository with default Entry Point discovery after T-12/T-13 improvements.

## Commands

Generate graph:

```sh
uv run --project packages/analyzer avt analyze . --no-timestamp --out /tmp/avt-self-graph.json
python -m json.tool /tmp/avt-self-graph.json >/dev/null
```

Build and serve viewer with the real graph as the sample graph:

```sh
cd apps/viewer
npm run build
cp /tmp/avt-self-graph.json dist/sample-graph.json
python -m http.server 4173 --directory dist
```

Headless browser capture:

```sh
chromium --headless --no-sandbox --disable-gpu --virtual-time-budget=3000 \
  --dump-dom http://127.0.0.1:4173/ \
  > docs/validation/artifacts/viewer-real-graph-dom.html

chromium --headless --no-sandbox --disable-gpu --virtual-time-budget=3000 \
  --screenshot=docs/validation/artifacts/viewer-real-graph.png \
  --window-size=1440,1000 \
  http://127.0.0.1:4173/
```

## Artifacts

- `docs/validation/artifacts/viewer-real-graph-dom.html`
- `docs/validation/artifacts/viewer-real-graph.png`

## Checks

Headless DOM checks found:

- `Execution Flow Viewer`: yes
- `AVT`: yes
- `visible nodes`: yes
- `visible edges`: yes
- `cli_command: packages/analyzer/src/avt_analyzer/cli.py:main`: yes
- `analyze_command`: yes

Generated screenshot exists and is non-empty.

## Result

Pass for initial browser-load QA:

- the production viewer build serves successfully;
- the real AVT graph loads through the same `/sample-graph.json` path used by the app;
- the page renders the AVT project summary, selected Entry Point, and selected Execution Flow content;
- screenshot capture confirms a rendered browser page.

## Caveats

- This is headless/browser-load QA, not interactive human QA.
- The file picker path was not exercised in headless Chromium.
- Edge filter toggles and node/edge click inspector behavior should receive interactive QA in a normal browser before user-facing release.
- The DOM dump did not expose every edge reason string as searchable text; React Flow renders graph internals in its own DOM structure and the selected flow lists may not make every reason visible in the initial viewport.

## Follow-up recommendation

Add automated browser tests with Playwright or Vitest/browser once viewer behavior stabilizes. Test cases should cover:

- loading a user-selected graph file;
- selecting Entry Points;
- toggling confirmed/uncertain/rejected edges;
- clicking a node and edge to populate the inspector;
- confirming/rejecting an Uncertain Edge when overlay editing is implemented.
