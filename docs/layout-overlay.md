# AVT Layout Overlay

Layout Overlays store viewer-only presentation edits, such as manually moved node positions. They do not change source code, graph facts, certainty, or analyzer output.

## Default location

Suggested project-local path:

```text
<project>/.avt/layout.json
```

The viewer can also load/export layout overlays from any JSON file.

## Schema version 1

```json
{
  "kind": "avt-layout-overlay",
  "version": 1,
  "project_name": "generic hiring-process demo API",
  "positions": {
    "flow:entry:web_route:app/api/endpoints/users.py:login_for_access_token:19:hierarchy-swimlane:context=true:external=true:labels=kind": {
      "node:function:app/api/endpoints/users.py:login_for_access_token": { "x": 640, "y": 120 }
    }
  }
}
```

## Fields

- `kind` — must be `avt-layout-overlay`.
- `version` — currently `1`.
- `project_name` — optional graph project name. The viewer warns when it differs from the loaded graph.
- `positions` — map of edited view keys to node positions.

## Edited view key

A view key is built from:

- selected flow/group id;
- selected diagram layout;
- hierarchy context visibility;
- External Interaction visibility;
- edge label mode.

This keeps edits scoped to the exact view where they were made.

## Position keys

Within a view, each key is a graph node id and each value is an `{ "x", "y" }` position object.

## Rules

- Layout overlays are presentation-only.
- They are safe to keep out of source repositories or commit intentionally as project-local visualization preferences.
- Loading a graph clears in-memory layout edits.
- Loading a layout overlay replaces current in-memory layout edits.
- `Reset layout` clears edits only for the current selected view.

## Future fields

Possible future versioned additions:

- hidden nodes;
- pinned nodes;
- color overrides;
- container sizes, once resize is implemented safely.
