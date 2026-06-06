# AVT Analysis Overlay

Analysis Overlays let a developer correct AVT uncertainty without modifying target source code.

They are intended for project-local human review state:

```text
<project>/.avt/overlay.json
```

The analyzer reads this file automatically when present, or explicitly with `--overlay`.

## Schema

```json
{
  "edge_resolutions": [
    {
      "edge_id": "edge:call:uncertain:...",
      "certainty": "confirmed"
    },
    {
      "edge_id": "edge:call:uncertain:...",
      "certainty": "rejected"
    }
  ]
}
```

Rules:

- `edge_id` must reference an existing graph edge.
- `certainty` must be `confirmed` or `rejected`.
- Overlay resolutions apply only to edges that were originally `uncertain`.
- Invalid entries create graph warnings instead of modifying source code.

## Viewer round trip

1. Generate a graph.
2. Open it in the viewer.
3. Click an uncertain edge.
4. Use the edge inspector to **Confirm edge** or **Reject edge**.
5. Use **Export overlay JSON**.
6. Save as `<project>/.avt/overlay.json` or another chosen path.
7. Re-run analysis with the overlay.

Explicit overlay command:

```sh
uv run --project packages/analyzer avt analyze /path/to/project \
  --overlay /path/to/overlay.json \
  --out /tmp/avt-graph-with-overlay.json
```

Automatic project-local overlay:

```sh
mkdir -p /path/to/project/.avt
cp exported-overlay.json /path/to/project/.avt/overlay.json
uv run --project packages/analyzer avt analyze /path/to/project \
  --out /tmp/avt-graph-with-overlay.json
```

AVT must not create or edit `.avt/overlay.json` in target projects by itself during analysis. The developer chooses where to save exported overlay files.

## Validation example

The AVT repo itself currently has an uncertain argparse dispatch edge. This command confirms one uncertain edge through an overlay:

```sh
cat >/tmp/avt-self-overlay.json <<'JSON'
{
  "edge_resolutions": [
    {
      "edge_id": "edge:call:uncertain:node:function:packages/analyzer/src/avt_analyzer/cli.py:main->node:function:packages/analyzer/src/avt_analyzer/cli.py:analyze_command:197:11",
      "certainty": "confirmed"
    }
  ]
}
JSON

uv run --project packages/analyzer avt analyze . \
  --no-timestamp \
  --overlay /tmp/avt-self-overlay.json \
  --out /tmp/avt-self-overlay-graph.json
```

Expected result for that edge:

```json
{
  "certainty": "confirmed",
  "evidence": {
    "reason": {
      "code": "overlay_resolution",
      "label": "Analysis Overlay marked edge as confirmed"
    }
  }
}
```

## Relationship to Layout Overlay

Analysis Overlay changes edge certainty in analyzer output. Layout Overlay changes only viewer presentation such as manual node positions.

Use:

- Analysis Overlay for graph review/correction.
- Layout Overlay for diagram editing/presentation.
