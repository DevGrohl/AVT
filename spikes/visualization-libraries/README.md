# Visualization Libraries Spike

Compare Cytoscape.js, D3.js, and React Flow using the same Execution Flow Graph fixture.

Shared fixture:

- `sample-graph.json` — minimal full-shape Execution Flow Graph copied from analyzer contract fixtures.

## Phase 1 viewer requirements

- Load static/local Execution Flow Graph JSON from disk/browser file input.
- Show one selected Execution Flow by default, not the entire project graph.
- Render function/method/external nodes and call/await/external interaction edges.
- Preserve hierarchy context for module/class/function grouping.
- Visually distinguish confirmed, uncertain, and rejected edges.
- Support click-to-inspect metadata.
- Support filters for uncertain/rejected edges and External Interactions.
- Be practical in React + TypeScript with a short path to a useful first viewer.

## Comparison matrix

| Criterion | Cytoscape.js | D3.js | React Flow |
| --- | --- | --- | --- |
| React integration | Usable through wrappers, but core is framework-neutral | Manual integration required | Native React model |
| Nodes/edges rendering | Strong graph primitives | Fully custom | Strong node/edge primitives |
| Hierarchy/grouping | Compound nodes supported | Fully custom | Parent/sub-flow nodes supported |
| Layout quality | Good with extensions; extra setup for dagre/elk | Fully custom | Good with dagre/elk integration path |
| Metadata inspector | Custom UI around graph events | Fully custom | Natural React component state |
| Filtering/toggles | Supported but imperative | Fully custom | Natural declarative filtering |
| TypeScript ergonomics | Good, but graph data model adapter needed | Low-level/manual | Good, fits viewer app shape |
| Performance expectation | Best for very large graph exploration | Depends on custom implementation | Good for selected-flow-first UI |
| Implementation speed | Medium | Slow | Fast |
| Risk | Layout/plugin complexity | Too much custom graph/UI work | Very large whole-project graph may need optimization |

## Notes by library

### Cytoscape.js

Strengths:

- Mature graph visualization library.
- Compound nodes fit hierarchy grouping.
- Better fit if AVT later needs whole-project graph exploration with thousands of visible nodes.

Weaknesses:

- React integration is less direct than React Flow.
- Inspector, filters, and overlay interactions are event/adapter work around an imperative graph instance.
- Layout extension choice remains a separate decision.

Assessment: strong fallback if selected-flow-first grows into large interactive graph exploration.

### D3.js

Strengths:

- Maximum rendering/layout control.
- Can implement exactly the visual language AVT wants.

Weaknesses:

- Too much low-level work for Phase 1.
- React integration and graph interaction state would be custom.
- Performance and layout quality depend heavily on custom implementation.

Assessment: not the right Phase 1 default. Use later only for bespoke visuals that graph libraries cannot support.

### React Flow

Strengths:

- Best fit for Vite + React + TypeScript viewer scaffold.
- Custom node/edge components map well to AVT node kinds, certainty, markers, and External Interactions.
- Viewer interactions are normal React state: selected node, selected flow, filters, inspector panel, overlay edits.
- Parent nodes can represent hierarchy context for the selected flow.
- Fastest path to a useful local viewer.

Weaknesses:

- Not optimized for rendering the entire project graph at once.
- Needs layout integration (dagre/elk) for readable automatic layouts.
- Large graph performance must be tested with generated fixtures before expanding beyond selected-flow view.

Assessment: best Phase 1 choice because AVT explicitly shows selected Execution Flow first.

## Performance test plan

Use generated graph fixtures with approximate sizes:

- 50 nodes / 100 edges
- 200 nodes / 500 edges
- 1,000 nodes / 3,000 edges

For Phase 1, performance pass/fail should be measured on selected-flow rendering, not whole-project rendering:

- initial render under roughly 1 second for 200/500 selected flow fixture;
- interaction/filter response feels immediate for 200/500;
- 1,000/3,000 may require viewport culling, selected-flow slicing, or fallback layout tuning.

## Recommendation

Use **React Flow** for the Phase 1 static/local viewer.

Rationale:

- AVT's primary view is selected Execution Flow, not whole-project graph exploration.
- React Flow minimizes custom integration work in the planned React + TypeScript viewer.
- It supports the near-term interaction model: inspector, filters, hierarchy context, marker/external styling, and overlay export.
- Cytoscape.js remains the fallback if whole-project graph exploration becomes the dominant UX.

Decision summary: React Flow is the preferred renderer for AVT's current selected-flow viewer; Cytoscape.js remains a fallback if whole-project graph exploration becomes the dominant UX.
