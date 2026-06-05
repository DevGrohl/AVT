# AVT Viewer

Static/local web viewer for AVT Execution Flow Graph JSON.

Stack:

- Vite
- React
- TypeScript
- React Flow (`@xyflow/react`) per `docs/adr/0003-use-react-flow-for-phase-1-viewer.md`

## Current scaffold

The scaffold loads `public/sample-graph.json` by default and lets a Developer load another graph with a local JSON file picker.

Current UI shows:

- graph metadata summary and global secret warning count;
- Entry Point selector;
- selected Execution Flow node/edge/marker counts;
- React Flow rendering for the selected Execution Flow;
- hierarchy context through ancestor module/class nodes;
- node/edge inspector;
- Flow Marker counts/details on nodes;
- styling for External Interactions and certainty states;
- filters for confirmed, uncertain, and rejected edges;
- selected flow nodes and edges as structured lists.

## Commands

From `apps/viewer`:

```sh
npm install
npm run dev
npm run build
```

The app is static/local and does not require a backend.
