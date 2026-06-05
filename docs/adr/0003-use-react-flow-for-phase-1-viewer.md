# ADR 0003: Use React Flow for the Phase 1 Viewer

## Status

Accepted

## Context

AVT Phase 1 needs a static/local web viewer for Execution Flow Graph JSON. The viewer should show a selected Execution Flow by default, with hierarchy as context rather than the main product promise.

The restart plan called for a visualization spike comparing:

- Cytoscape.js
- D3.js
- React Flow

The comparison is recorded in `spikes/visualization-libraries/README.md` using `spikes/visualization-libraries/sample-graph.json` as the shared fixture.

## Decision

Use **React Flow** for the Phase 1 viewer.

## Rationale

React Flow best matches the planned Vite + React + TypeScript viewer and the selected-flow-first product shape.

It gives AVT a short path to:

- custom node and edge rendering for functions, methods, External Interactions, and certainty states;
- React state-driven inspector panels and filters;
- parent/group nodes for hierarchy context;
- overlay confirmation/rejection interactions;
- incremental layout integration with dagre or elk.

Cytoscape.js is stronger for large whole-graph exploration, but that is not the Phase 1 default view. D3.js offers maximum control but requires too much custom graph/UI infrastructure for the first useful viewer.

## Consequences

- Viewer implementation proceeds with React Flow.
- Layout remains a separate implementation detail, likely dagre or elk.
- The viewer should continue slicing to a selected Execution Flow by default to avoid unnecessary whole-project rendering costs.
- Cytoscape.js remains a fallback if future AVT requirements shift toward large whole-project graph exploration.
