# Code-Flow-First Viewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the viewer default to a code-flow-first diagram where one entry point reads as an ordered procedural story, with internal steps inside the entry-point boundary and externals outside it.

**Architecture:** Keep the existing graph JSON contract and fallback layouts. Replace the current code-flow layout internals with a dedicated render model that groups one selected flow into an entry-point container, an ordered vertical sequence of step nodes, and external nodes outside the container. Use the same visual grammar across languages; sparse analyzer data should produce a sparse version of the same model, not a different model.

**Tech Stack:** React, TypeScript, Vite, React Flow (`@xyflow/react`), Bun test runner, Python analyzer CLI for smoke data.

## Global Constraints

- Make AVT answer: `what happens, in what order, inside this entry point?`
- Use one primary visual grammar across Python, JavaScript, and Rust.
- Keep alternate layouts available as fallback/reference views.
- No promise of perfect whole-program execution order.
- No requirement to infer every statement as its own node.
- No removal of fallback layouts in this slice.
- No fake semantic parity when analyzer facts are absent.
- No repository-wide architecture map as the default mental model.
- Internal app-code steps stay inside the entry-point container.
- External interactions sit outside the container and connect from the step that triggers them.
- Code-flow-first becomes the default layout.
- Docs must explain the new primary mental model without overstating analyzer certainty.

---

## File Structure

- Create: `apps/viewer/src/codeFlow.tsx`
  - Own the code-flow render model and sequencing helpers instead of burying the default layout logic inside `main.tsx`.
- Create: `apps/viewer/src/codeFlow.test.ts`
  - Bun tests for ordering, container placement, monolithic-flow fallback, and external placement.
- Modify: `apps/viewer/src/main.tsx`
  - Switch default layout to `code-flow`, import the new builder, update copy, and keep fallback layouts available.
- Modify: `apps/viewer/src/styles.css`
  - Add minimal styles for the entry-point boundary/container and step emphasis without touching unrelated theme rules.
- Modify: `apps/viewer/tsconfig.json`
  - Exclude Bun-only `*.test.ts` files from the production TypeScript build if not already excluded.
- Modify: `apps/viewer/README.md`
  - Document code-flow-first as the default and fallback layouts as secondary.
- Modify: `apps/viewer/scripts/smoke.mjs`
  - Accept either classic flow DOM text or the new code-flow-first cues in smoke output.

---

### Task 1: Extract a dedicated code-flow render model and prove step ordering

**Files:**
- Create: `apps/viewer/src/codeFlow.tsx`
- Create: `apps/viewer/src/codeFlow.test.ts`

**Interfaces:**
- Consumes:
  - `GraphNode`, `GraphEdge`, `FlowMarker`, `ExecutionFlow`, `EntryPoint` from `apps/viewer/src/graph.ts`
- Produces:
  - `interface CodeFlowRenderModel { reactFlowNodes: FlowNode[]; reactFlowEdges: FlowEdge[]; containerNodeId: string; stepNodeIds: string[]; externalNodeIds: string[] }`
  - `buildCodeFlowRenderModel(args: { flow: ExecutionFlow; entryPoint: EntryPoint | null; nodes: GraphNode[]; edges: GraphEdge[]; markersByNodeId: Map<string, FlowMarker[]>; }): CodeFlowRenderModel`

- [ ] **Step 1: Write the failing render-model test**

Create `apps/viewer/src/codeFlow.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';

import type { EntryPoint, ExecutionFlow, FlowMarker, GraphEdge, GraphNode } from './graph';
import { buildCodeFlowRenderModel } from './codeFlow';

const entryPoint: EntryPoint = {
  id: 'entry:main',
  kind: 'cli_command',
  node_id: 'function:main',
  label: 'cli_command: src/main.rs:main',
  evidence: {
    location: { path: 'src/main.rs', line: 18, column: 0 },
    reason: { label: "Called from if __name__ == '__main__'" },
  },
};

const flow: ExecutionFlow = {
  id: 'flow:main',
  entry_point_id: 'entry:main',
  node_ids: ['function:main', 'function:load', 'function:connect', 'function:process', 'external:http'],
  edge_ids: ['edge:1', 'edge:2', 'edge:3', 'edge:4'],
  marker_ids: [],
};

const nodes: GraphNode[] = [
  { id: 'function:main', kind: 'function', label: 'main', path: 'src/main.rs', qualified_name: 'main' },
  { id: 'function:load', kind: 'function', label: 'load_config', path: 'src/main.rs', qualified_name: 'load_config' },
  { id: 'function:connect', kind: 'function', label: 'connect_db', path: 'src/main.rs', qualified_name: 'connect_db' },
  { id: 'function:process', kind: 'function', label: 'process', path: 'src/main.rs', qualified_name: 'process' },
  { id: 'external:http', kind: 'external', label: 'requests.get', path: 'external' },
];

const edges: GraphEdge[] = [
  { id: 'edge:1', kind: 'call', certainty: 'confirmed', source: 'function:main', target: 'function:load', evidence: { location: { path: 'src/main.rs', line: 20, column: 2 }, reason: { label: 'call' } } },
  { id: 'edge:2', kind: 'call', certainty: 'confirmed', source: 'function:load', target: 'function:connect', evidence: { location: { path: 'src/main.rs', line: 21, column: 2 }, reason: { label: 'call' } } },
  { id: 'edge:3', kind: 'call', certainty: 'confirmed', source: 'function:connect', target: 'function:process', evidence: { location: { path: 'src/main.rs', line: 22, column: 2 }, reason: { label: 'call' } } },
  { id: 'edge:4', kind: 'external_interaction', certainty: 'confirmed', source: 'function:process', target: 'external:http', evidence: { location: { path: 'src/main.rs', line: 23, column: 2 }, reason: { label: 'network' } } },
];

const markersByNodeId = new Map<string, FlowMarker[]>();

describe('buildCodeFlowRenderModel', () => {
  test('orders internal steps vertically and places externals outside the container', () => {
    const model = buildCodeFlowRenderModel({ flow, entryPoint, nodes, edges, markersByNodeId });

    expect(model.containerNodeId).toBe('container:entry:main');
    expect(model.stepNodeIds).toEqual([
      'step:function:main',
      'step:function:load',
      'step:function:connect',
      'step:function:process',
    ]);
    expect(model.externalNodeIds).toEqual(['step:external:http']);

    const root = model.reactFlowNodes.find((node) => node.id === 'step:function:main');
    const second = model.reactFlowNodes.find((node) => node.id === 'step:function:load');
    const third = model.reactFlowNodes.find((node) => node.id === 'step:function:connect');
    const external = model.reactFlowNodes.find((node) => node.id === 'step:external:http');

    expect(root).toBeDefined();
    expect(second).toBeDefined();
    expect(third).toBeDefined();
    expect(external).toBeDefined();
    expect((root?.position.y ?? 0) < (second?.position.y ?? 0)).toBe(true);
    expect((second?.position.y ?? 0) < (third?.position.y ?? 0)).toBe(true);
    expect((external?.position.x ?? 0) > (third?.position.x ?? 0)).toBe(true);
  });

  test('keeps monolithic entry points useful with control-step placeholders', () => {
    const markers = new Map<string, FlowMarker[]>([
      ['function:main', [
        { id: 'marker:loop', kind: 'loop', node_id: 'function:main', evidence: { location: { path: 'src/main.rs', line: 30, column: 2 }, reason: { label: 'for item in items' } } },
        { id: 'marker:return', kind: 'return', node_id: 'function:main', evidence: { location: { path: 'src/main.rs', line: 48, column: 2 }, reason: { label: 'return Ok(())' } } },
      ]],
    ]);

    const model = buildCodeFlowRenderModel({ flow: { ...flow, node_ids: ['function:main'], edge_ids: [] }, entryPoint, nodes: [nodes[0]], edges: [], markersByNodeId: markers });

    expect(model.stepNodeIds).toContain('step:function:main');
    expect(model.stepNodeIds).toContain('step:marker:loop');
    expect(model.stepNodeIds).toContain('step:marker:return');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
bun test src/codeFlow.test.ts
```

Working directory: `apps/viewer`

Expected: FAIL because `./codeFlow` does not exist.

- [ ] **Step 3: Write the minimal render-model builder**

Create `apps/viewer/src/codeFlow.tsx`:

```tsx
import type { Edge as FlowEdge, Node as FlowNode } from '@xyflow/react';

import type { EntryPoint, ExecutionFlow, FlowMarker, GraphEdge, GraphNode } from './graph';

export interface CodeFlowRenderModel {
  reactFlowNodes: FlowNode[];
  reactFlowEdges: FlowEdge[];
  containerNodeId: string;
  stepNodeIds: string[];
  externalNodeIds: string[];
}

export function buildCodeFlowRenderModel({
  flow,
  entryPoint,
  nodes,
  edges,
  markersByNodeId,
}: {
  flow: ExecutionFlow;
  entryPoint: EntryPoint | null;
  nodes: GraphNode[];
  edges: GraphEdge[];
  markersByNodeId: Map<string, FlowMarker[]>;
}): CodeFlowRenderModel {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const flowNodes = flow.node_ids.map((id) => nodeById.get(id)).filter((node): node is GraphNode => Boolean(node));
  const internalNodes = flowNodes.filter((node) => node.kind !== 'external');
  const externalNodes = flowNodes.filter((node) => node.kind === 'external');
  const flowEdges = edges.filter((edge) => flow.edge_ids.includes(edge.id));
  const orderedInternal = orderInternalSteps(internalNodes, flowEdges, entryPoint);
  const markerSteps = orderedMarkerSteps(orderedInternal, markersByNodeId);
  const allInternalSteps = markerSteps.length ? markerSteps : orderedInternal.map((node) => ({ id: `step:${node.id}`, label: node.label, kind: node.kind }));
  const containerNodeId = `container:${entryPoint?.id ?? flow.id}`;

  const containerNode: FlowNode = {
    id: containerNodeId,
    position: { x: 40, y: 40 },
    data: { label: entryPoint?.label ?? flow.id },
    style: { width: 760, height: Math.max(260, 140 + allInternalSteps.length * 140), border: '2px solid #315efb', borderRadius: 20, background: 'rgba(49,94,251,0.04)' },
  };

  const internalFlowNodes = allInternalSteps.map((step, index) => ({
    id: step.id,
    parentId: containerNodeId,
    extent: 'parent' as const,
    position: { x: 80, y: 90 + index * 120 },
    data: { label: `${index + 1}. ${step.label}` },
    style: { width: 260, borderWidth: 1.5 },
  } satisfies FlowNode));

  const externalFlowNodes = externalNodes.map((node, index) => ({
    id: `step:${node.id}`,
    position: { x: 980, y: 140 + index * 120 },
    data: { label: node.label },
    style: { width: 220, background: '#fff3cd', borderColor: '#c9a227' },
  } satisfies FlowNode));

  const internalEdges = allInternalSteps.slice(1).map((step, index) => ({
    id: `edge:sequence:${allInternalSteps[index].id}:${step.id}`,
    source: allInternalSteps[index].id,
    target: step.id,
    markerEnd: 'arrowclosed',
  } satisfies FlowEdge));

  const externalEdges = flowEdges
    .filter((edge) => edge.kind === 'external_interaction')
    .map((edge) => ({
      id: `edge:external:${edge.id}`,
      source: `step:${edge.source}`,
      target: `step:${edge.target}`,
      markerEnd: 'arrowclosed',
    } satisfies FlowEdge));

  return {
    reactFlowNodes: [containerNode, ...internalFlowNodes, ...externalFlowNodes],
    reactFlowEdges: [...internalEdges, ...externalEdges],
    containerNodeId,
    stepNodeIds: allInternalSteps.map((step) => step.id),
    externalNodeIds: externalFlowNodes.map((node) => node.id),
  };
}

function orderInternalSteps(nodes: GraphNode[], edges: GraphEdge[], entryPoint: EntryPoint | null): GraphNode[] {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, number>();
  for (const node of nodes) {
    outgoing.set(node.id, []);
    incoming.set(node.id, 0);
  }
  for (const edge of edges) {
    if (!nodeById.has(edge.source) || !nodeById.has(edge.target) || edge.kind === 'external_interaction') continue;
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge.target]);
    incoming.set(edge.target, (incoming.get(edge.target) ?? 0) + 1);
  }
  const preferredRoot = entryPoint?.node_id ?? '';
  const queue = nodes
    .filter((node) => (incoming.get(node.id) ?? 0) === 0)
    .sort((a, b) => Number(b.id === preferredRoot) - Number(a.id === preferredRoot) || a.label.localeCompare(b.label));
  const seen = new Set<string>();
  const ordered: GraphNode[] = [];
  while (queue.length) {
    const node = queue.shift()!;
    if (seen.has(node.id)) continue;
    seen.add(node.id);
    ordered.push(node);
    for (const nextId of (outgoing.get(node.id) ?? []).sort()) {
      queue.push(nodeById.get(nextId)!);
    }
  }
  return [...ordered, ...nodes.filter((node) => !seen.has(node.id)).sort((a, b) => a.label.localeCompare(b.label))];
}

function orderedMarkerSteps(nodes: GraphNode[], markersByNodeId: Map<string, FlowMarker[]>): Array<{ id: string; label: string; kind: string }> {
  const steps: Array<{ id: string; label: string; kind: string }> = [];
  for (const node of nodes) {
    steps.push({ id: `step:${node.id}`, label: node.label, kind: node.kind });
    const markers = (markersByNodeId.get(node.id) ?? []).filter((marker) => marker.kind === 'loop' || marker.kind === 'conditional' || marker.kind === 'return' || marker.kind === 'raise');
    for (const marker of markers) {
      steps.push({ id: `step:${marker.id}`, label: marker.evidence.reason.label || marker.kind, kind: marker.kind });
    }
  }
  return steps;
}
```

- [ ] **Step 4: Run the render-model test to verify it passes**

Run:

```bash
bun test src/codeFlow.test.ts
```

Working directory: `apps/viewer`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/viewer/src/codeFlow.tsx apps/viewer/src/codeFlow.test.ts
git commit -m "feat: add code-flow render model"
```

---

### Task 2: Make code-flow-first the default viewer layout

**Files:**
- Modify: `apps/viewer/src/main.tsx`
- Modify: `apps/viewer/src/styles.css`
- Modify: `apps/viewer/tsconfig.json`

**Interfaces:**
- Consumes:
  - `buildCodeFlowRenderModel()` from `apps/viewer/src/codeFlow.tsx`
- Produces:
  - `diagramLayout` default `'code-flow'`
  - `CodeFlowPanel` UI path in `main.tsx`

- [ ] **Step 1: Write the failing integration test**

Append to `apps/viewer/src/codeFlow.test.ts`:

```ts
test('uses code-flow as the default layout label in viewer controls', async () => {
  const source = await Bun.file('src/main.tsx').text();
  expect(source.includes("useState<DiagramLayout>('code-flow')")).toBe(true);
  expect(source.includes('Code flow paths')).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
bun test src/codeFlow.test.ts
```

Working directory: `apps/viewer`

Expected: FAIL because `main.tsx` still defaults to `hierarchy-swimlane`.

- [ ] **Step 3: Wire the new render model into the main panel**

In `apps/viewer/src/main.tsx`, change the default layout state:

```ts
const [diagramLayout, setDiagramLayout] = useState<DiagramLayout>('code-flow');
```

Add import near the top:

```ts
import { buildCodeFlowRenderModel } from './codeFlow';
```

Add after `flowModel`:

```ts
  const codeFlowModel = useMemo(() => {
    if (!selectedFlow || !graph) return null;
    return buildCodeFlowRenderModel({
      flow: selectedFlow,
      entryPoint: selectedEntryPoint,
      nodes: flowModel.flowNodes.map((node) => node.item),
      edges: flowModel.flowEdges.map((edge) => edge.item),
      markersByNodeId: flowModel.markersByNodeId,
    });
  }, [graph, selectedFlow, selectedEntryPoint, flowModel]);
```

Replace the `selectedFlow ? (...)` branch in the main panel with a code-flow-first branch:

```tsx
{selectedFlow ? (
  diagramLayout === 'code-flow' && codeFlowModel ? (
    <CodeFlowPanel
      flow={selectedFlow}
      label={selectedOption?.label ?? selectedFlow.id}
      importance={selectedImportance}
      model={codeFlowModel}
    />
  ) : (
    <>
      <FlowHeader
        flow={selectedFlow}
        label={selectedOption?.label ?? selectedFlow.id}
        nodeCount={flowModel.flowNodes.length}
        edgeCount={flowModel.flowEdges.length}
        layout={diagramLayout}
        editedNodeCount={editedNodeCount}
        importance={selectedImportance}
        onResetLayout={handleResetLayout}
      />
      <DeveloperOnboardingPanel
        projectName={graph.metadata.project_name}
        flowLabel={selectedOption?.label ?? selectedFlow.id}
        entryPoint={selectedEntryPoint}
        nodes={flowModel.flowNodes}
        edges={flowModel.flowEdges}
      />
      <div className="graphCanvas" aria-label="Selected Execution Flow graph">
        <ReactFlow /* existing props unchanged */>
```

Add the `CodeFlowPanel` component below `FlowHeader`:

```tsx
function CodeFlowPanel({
  flow,
  label,
  importance,
  model,
}: {
  flow: ExecutionFlow;
  label: string;
  importance: EntryImportance | null;
  model: ReturnType<typeof buildCodeFlowRenderModel>;
}) {
  return (
    <>
      <div className="flowHeader">
        <div>
          <p className="eyebrow">Code-flow-first default</p>
          <h2>{label}</h2>
          <p className="hint">Ordered internal steps stay inside the entry-point boundary. Externals escape the box.</p>
          {importance ? <p className="rankReason">Rank score {importance.score}: {importance.reasons.join('; ')}</p> : null}
        </div>
        <div className="counts">
          <span>{model.stepNodeIds.length} ordered steps</span>
          <span>{model.externalNodeIds.length} externals</span>
          <span>{flow.marker_ids.length} markers</span>
        </div>
      </div>
      <div className="graphCanvas codeFlowCanvas" aria-label="Selected code flow graph">
        <ReactFlow nodes={model.reactFlowNodes} edges={model.reactFlowEdges} fitView fitViewOptions={{ padding: 0.18 }}>
          <Background />
          <Controls />
          <MiniMap pannable zoomable />
        </ReactFlow>
      </div>
    </>
  );
}
```

- [ ] **Step 4: Add minimal styles for the new default view**

Append to `apps/viewer/src/styles.css`:

```css
.codeFlowCanvas .react-flow__node {
  border-radius: 14px;
}

.codeFlowCanvas .react-flow__node.selected,
.codeFlowCanvas .react-flow__node:focus-visible {
  box-shadow: 0 0 0 2px rgba(49, 94, 251, 0.18);
}

.codeFlowCanvas .react-flow__edge-path {
  stroke-width: 2.2;
}
```

- [ ] **Step 5: Exclude Bun test files from the production build if needed**

If `apps/viewer/tsconfig.json` does not already contain it, set:

```json
"exclude": ["src/**/*.test.ts"]
```

- [ ] **Step 6: Run tests and viewer build**

Run:

```bash
bun test src/codeFlow.test.ts
bun run build
```

Working directory: `apps/viewer`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/viewer/src/main.tsx apps/viewer/src/styles.css apps/viewer/tsconfig.json
git commit -m "feat: make code flow the default view"
```

---

### Task 3: Document the new default and verify on real graphs

**Files:**
- Modify: `apps/viewer/README.md`
- Modify: `apps/viewer/scripts/smoke.mjs`

**Interfaces:**
- Consumes:
  - `code-flow` layout in `main.tsx`
  - `buildCodeFlowRenderModel()` from `apps/viewer/src/codeFlow.tsx`
- Produces:
  - Updated viewer docs and smoke checks for the new default mental model.

- [ ] **Step 1: Update README to describe the new default mental model**

In `apps/viewer/README.md`, replace the default-layout paragraph under `### Graph canvas` with:

```md
The main panel now defaults to a code-flow-first view.
It optimizes for “what happens, in what order, inside this entry point?” instead of raw relationship breadth.
Internal steps stay inside the entry-point boundary, while external interactions sit outside it.
Alternate layouts remain available as fallback/reference views.
```

Replace the `V1 stable layout` block with:

```md
Default layout:

- **Code flow paths** — primary procedural view. The Entry Point becomes the main boundary, internal calls/control steps read top-to-bottom in execution order, and external interactions escape the boundary.

Fallback/reference layouts:

- **Swimlane hierarchy** — relationship-first lane view.
- **Outline + focused graph** — compact hierarchy outline plus focused behavior nodes.
- **Nested ownership map** — modules/classes as container areas.
- **Layered flow** — left-to-right dependency emphasis.
- **Circular relationships** — cluster/cycle overview.
- **Compact grid** — dense scan-friendly fallback.
```

Add this sentence after the fallback list:

```md
The same visual grammar should apply across Python, JavaScript, and Rust; weaker analyzer depth should make the default diagram sparser, not semantically different.
```

- [ ] **Step 2: Update smoke script for the new default cues**

In `apps/viewer/scripts/smoke.mjs`, replace the `checks` array with:

```js
  const checks = [
    ['title', 'Execution Flow Viewer'],
    ['default code-flow cue', 'Code-flow-first default'],
    ['react-flow node DOM', 'react-flow__node'],
    ['react-flow edge DOM', 'react-flow__edge'],
    ...extraChecks,
  ];
```

Keep the rest of the script unchanged.

- [ ] **Step 3: Run focused viewer verification**

Run:

```bash
bun test src/codeFlow.test.ts
bun run build
```

Working directory: `apps/viewer`

Expected: PASS.

- [ ] **Step 4: Run real-graph smoke against HunterCake**

From `apps/viewer`:

```bash
uv run --project /mnt/shared/Documents/Projects/AVT/packages/analyzer avt analyze /home/devgrohl/Projects/HunterCake --no-timestamp --out /tmp/huntercake-avt.json
AVT_VIEWER_SMOKE_GRAPH=/tmp/huntercake-avt.json bun run smoke
```

Expected: analyzer exits 0 and viewer smoke passes with React Flow nodes/edges present against the real graph.

- [ ] **Step 5: Ponytail pass**

Inspect the diff and cut anything beyond this slice:

- Remove any attempt to add statement-level-everything rendering.
- Remove any attempt to invent cross-language analyzer facts.
- Remove any new repo-wide map default.
- Keep only: default layout switch, entry-point container/default code-flow render, docs, smoke/test coverage.

- [ ] **Step 6: Commit docs and smoke updates**

```bash
git add apps/viewer/README.md apps/viewer/scripts/smoke.mjs
git commit -m "docs: describe code-flow-first default"
```

- [ ] **Step 7: Final status check**

Run:

```bash
git status --short
```

Expected: no output.

Final response must include:

```text
Gate: validated viewer bun tests, viewer build, HunterCake smoke; ponytail pass kept code-flow-first default and fallback layouts only.
```
