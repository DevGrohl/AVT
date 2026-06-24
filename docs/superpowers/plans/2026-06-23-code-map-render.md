# Code-Map Render Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a file-centered code-map render for non-Python `language_facts` selections in the viewer while keeping Python Execution Flow rendering unchanged.

**Architecture:** Keep the current Execution Flow path intact. Add a small viewer selection seam for `code_map` items plus a separate code-map render-model builder that feeds React Flow with file-root, definition, and import nodes. Do not manufacture fake flow semantics from `language_facts`.

**Tech Stack:** React, TypeScript, Vite, React Flow (`@xyflow/react`), Bun test runner, Python analyzer CLI for real-graph smoke data.

## Global Constraints

- Keep existing Python Entry Point and grouped Execution Flow rendering unchanged.
- Render a selected `language_facts` file as a file-centered code map on the main canvas.
- Use only facts already present in analyzer output: file path, language, definitions, imports, warnings.
- Keep the distinction between Execution Flow and code map explicit in copy and behavior.
- No non-Python call graph.
- No Rust/JS/TS route discovery or entry-point inference.
- No fake flow edges or pseudo-behavior semantics.
- No nested ownership inference between definitions in this slice.
- No repository-wide code-map graph.
- No analyzer schema expansion beyond the already-approved `language_facts` facts.
- Warnings stay in the side/details panel, not as graph nodes.
- If there are no definitions and no imports, show `No code-map facts to render for this file.`
- Existing overlay/export flow behavior remains Execution Flow-specific.

---

## File Structure

- Create: `apps/viewer/src/selection.ts`
  - Shared `FlowSelectionOption` union and code-map option helpers.
- Create: `apps/viewer/src/selection.test.ts`
  - Bun tests for code-map option creation and selected-fact lookup.
- Create: `apps/viewer/src/codeMap.tsx`
  - Pure-ish code-map render-model builder that returns React Flow nodes/edges from one `LanguageFact`.
- Create: `apps/viewer/src/codeMap.test.ts`
  - Bun tests for file-root, definition-node, and import-node render model behavior.
- Modify: `apps/viewer/src/main.tsx`
  - Wire code-map selections into the existing dropdown and switch the main panel between flow mode and code-map mode.
- Modify: `apps/viewer/tsconfig.json`
  - Exclude Bun-only `*.test.ts` files from the production TypeScript build.
- Modify: `apps/viewer/README.md`
  - Document code-map selections and file-centered map render behavior.

---

### Task 1: Add code-map selection plumbing

**Files:**
- Create: `apps/viewer/src/selection.ts`
- Create: `apps/viewer/src/selection.test.ts`
- Modify: `apps/viewer/src/main.tsx`
- Modify: `apps/viewer/tsconfig.json`

**Interfaces:**
- Consumes: `ExecutionFlowGraph`, `LanguageFact` from `apps/viewer/src/graph.ts`.
- Produces:
  - `type FlowSelectionOption = { id: string; label: string; kind: 'entry' | 'group'; entryPointIds: string[] } | { id: string; label: string; kind: 'code_map'; entryPointIds: []; languageFactPath: string }`
  - `buildCodeMapOptions(languageFacts: LanguageFact[]): FlowSelectionOption[]`
  - `findSelectedLanguageFact(graph: ExecutionFlowGraph, option: FlowSelectionOption | null): LanguageFact | null`
  - `formatLanguageLabel(language: LanguageFact['language']): string`

- [ ] **Step 1: Write the failing selection test**

Create `apps/viewer/src/selection.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';

import type { ExecutionFlowGraph } from './graph';
import { buildCodeMapOptions, findSelectedLanguageFact } from './selection';

const graph: ExecutionFlowGraph = {
  metadata: {
    schema_version: '1',
    analyzer_version: 'test',
    project_name: 'huntercake',
  },
  entry_points: [],
  flows: [],
  nodes: [],
  edges: [],
  markers: [],
  warnings: [],
  language_facts: [
    {
      path: 'src/main.rs',
      language: 'rust',
      definitions: [{ kind: 'function', name: 'main', location: { path: 'src/main.rs', line: 18, column: 0 } }],
      imports: [{ module: 'std::fs', location: { path: 'src/main.rs', line: 13, column: 0 } }],
      warnings: [],
    },
    {
      path: 'web/router.ts',
      language: 'typescript',
      definitions: [{ kind: 'function', name: 'makeRouter', location: { path: 'web/router.ts', line: 1, column: 0 } }],
      imports: [],
      warnings: [],
    },
  ],
};

describe('code map selection options', () => {
  test('builds selectable options for language facts', () => {
    const options = buildCodeMapOptions(graph.language_facts);

    expect(options).toHaveLength(2);
    expect(options.some((option) => option.kind === 'code_map' && option.label.includes('Rust') && option.label.includes('src/main.rs'))).toBe(true);
    expect(options.some((option) => option.kind === 'code_map' && option.label.includes('TypeScript') && option.label.includes('web/router.ts'))).toBe(true);
  });

  test('resolves the selected language fact from a code-map option', () => {
    const option = buildCodeMapOptions(graph.language_facts).find((item) => item.languageFactPath === 'src/main.rs');

    expect(option).toBeDefined();
    expect(findSelectedLanguageFact(graph, option ?? null)?.path).toBe('src/main.rs');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
bun test src/selection.test.ts
```

Working directory: `apps/viewer`

Expected: FAIL because `./selection` does not exist yet.

- [ ] **Step 3: Write the minimal selection helper**

Create `apps/viewer/src/selection.ts`:

```ts
import type { ExecutionFlowGraph, LanguageFact } from './graph';

export type FlowSelectionOption =
  | {
      id: string;
      label: string;
      kind: 'entry' | 'group';
      entryPointIds: string[];
      languageFactPath?: never;
    }
  | {
      id: string;
      label: string;
      kind: 'code_map';
      entryPointIds: [];
      languageFactPath: string;
    };

export function buildCodeMapOptions(languageFacts: LanguageFact[]): FlowSelectionOption[] {
  return [...languageFacts]
    .sort((a, b) => a.language.localeCompare(b.language) || a.path.localeCompare(b.path))
    .map((fact) => ({
      id: `code_map:${fact.path}`,
      label: `Code map · ${formatLanguageLabel(fact.language)} · ${fact.path}`,
      kind: 'code_map',
      entryPointIds: [],
      languageFactPath: fact.path,
    }));
}

export function findSelectedLanguageFact(graph: ExecutionFlowGraph, option: FlowSelectionOption | null): LanguageFact | null {
  if (!option || option.kind !== 'code_map') return null;
  return graph.language_facts.find((fact) => fact.path === option.languageFactPath) ?? null;
}

export function formatLanguageLabel(language: LanguageFact['language']): string {
  switch (language) {
    case 'go':
      return 'Go';
    case 'javascript':
      return 'JavaScript';
    case 'rust':
      return 'Rust';
    case 'tsx':
      return 'TSX';
    case 'typescript':
      return 'TypeScript';
  }
}
```

- [ ] **Step 4: Wire code-map options into the existing selector**

In `apps/viewer/src/main.tsx`, change the imports at the top:

```ts
import type { EntryPoint, ExecutionFlow, ExecutionFlowGraph, FlowMarker, GraphEdge, GraphNode, GuideFile } from './graph';
import { isExecutionFlowGraph, isGuideFile } from './graph';
import { buildCodeMapOptions, type FlowSelectionOption } from './selection';
```

Delete the local `interface FlowSelectionOption` block.

In `buildSelectionOptions(graph)`, change the return line:

```ts
  return [...groupOptions, ...entryOptions, ...buildCodeMapOptions(graph.language_facts)];
```

In `SearchableSelectionDropdown`, update the button and search copy:

```tsx
<span>{selectedOption?.label ?? 'Select Entry Point / Group / Code Map'}</span>
```

```tsx
<label className="selectLabel" htmlFor="entryPointSearch">Search Entry Points / Groups / Code Maps</label>
```

```tsx
<div className="comboList" role="listbox" aria-label="Entry Point / Group / Code Map options">
```

```tsx
{options.length ? options.map(/* unchanged */) : <p className="hint">No matching Entry Points, groups, or code maps.</p>}
```

- [ ] **Step 5: Exclude Bun test files from the production build**

In `apps/viewer/tsconfig.json`, change the tail of the file:

```json
  "include": ["src"],
  "exclude": ["src/**/*.test.ts"],
  "references": []
```

- [ ] **Step 6: Run tests and build to verify they pass**

Run:

```bash
bun test src/selection.test.ts
bun run build
```

Working directory: `apps/viewer`

Expected: both PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/viewer/src/selection.ts apps/viewer/src/selection.test.ts apps/viewer/src/main.tsx apps/viewer/tsconfig.json
git commit -m "feat: add code map file selections"
```

---

### Task 2: Render the file-centered code map

**Files:**
- Create: `apps/viewer/src/codeMap.tsx`
- Create: `apps/viewer/src/codeMap.test.ts`
- Modify: `apps/viewer/src/main.tsx`

**Interfaces:**
- Consumes:
  - `LanguageFact` from `apps/viewer/src/graph.ts`
  - `FlowSelectionOption`, `findSelectedLanguageFact()`, `formatLanguageLabel()` from `apps/viewer/src/selection.ts`
- Produces:
  - `interface CodeMapRenderModel { reactFlowNodes: FlowNode[]; reactFlowEdges: FlowEdge[]; hasRenderableFacts: boolean }`
  - `buildCodeMapRenderModel(fact: LanguageFact): CodeMapRenderModel`

- [ ] **Step 1: Write the failing render-model test**

Create `apps/viewer/src/codeMap.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';

import type { LanguageFact } from './graph';
import { buildCodeMapRenderModel } from './codeMap';

const rustFact: LanguageFact = {
  path: 'src/main.rs',
  language: 'rust',
  definitions: [
    { kind: 'function', name: 'main', location: { path: 'src/main.rs', line: 18, column: 0 } },
    { kind: 'function', name: 'run_tui', location: { path: 'src/main.rs', line: 58, column: 0 } },
  ],
  imports: [
    { module: 'std::fs', location: { path: 'src/main.rs', line: 13, column: 0 } },
    { module: 'std::thread', location: { path: 'src/main.rs', line: 14, column: 0 } },
  ],
  warnings: [],
};

describe('code map render model', () => {
  test('builds a file-centered map with definition and import leaves', () => {
    const model = buildCodeMapRenderModel(rustFact);

    expect(model.hasRenderableFacts).toBe(true);
    expect(model.reactFlowNodes.some((node) => node.id === 'file:src/main.rs')).toBe(true);
    expect(model.reactFlowNodes.some((node) => node.id === 'definition:src/main.rs:function:main:18')).toBe(true);
    expect(model.reactFlowNodes.some((node) => node.id === 'import:src/main.rs:std::fs:13')).toBe(true);
    expect(model.reactFlowEdges.some((edge) => edge.source === 'file:src/main.rs' && edge.target === 'definition:src/main.rs:function:main:18')).toBe(true);
    expect(model.reactFlowEdges.some((edge) => edge.source === 'file:src/main.rs' && edge.target === 'import:src/main.rs:std::fs:13')).toBe(true);
  });

  test('reports empty render state when no definitions or imports exist', () => {
    const model = buildCodeMapRenderModel({ ...rustFact, definitions: [], imports: [] });

    expect(model.hasRenderableFacts).toBe(false);
    expect(model.reactFlowNodes).toHaveLength(1);
    expect(model.reactFlowEdges).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
bun test src/codeMap.test.ts
```

Working directory: `apps/viewer`

Expected: FAIL because `./codeMap` does not exist yet.

- [ ] **Step 3: Write the minimal code-map render-model builder**

Create `apps/viewer/src/codeMap.tsx`:

```tsx
import type { Edge as FlowEdge, Node as FlowNode } from '@xyflow/react';

import type { LanguageFact } from './graph';
import { formatLanguageLabel } from './selection';

export interface CodeMapRenderModel {
  reactFlowNodes: FlowNode[];
  reactFlowEdges: FlowEdge[];
  hasRenderableFacts: boolean;
}

const ROOT_X = 520;
const ROOT_Y = 280;
const DEFINITION_RADIUS = 260;
const IMPORT_RADIUS = 420;

export function buildCodeMapRenderModel(fact: LanguageFact): CodeMapRenderModel {
  const rootId = `file:${fact.path}`;
  const rootNode: FlowNode = {
    id: rootId,
    position: { x: ROOT_X, y: ROOT_Y },
    data: { label: `${formatLanguageLabel(fact.language)}\n${fact.path}` },
    style: { minWidth: 220, borderWidth: 2 },
  };

  const definitionNodes = fact.definitions.map((definition, index) => {
    const position = polar(index, Math.max(fact.definitions.length, 1), DEFINITION_RADIUS, 210, 330);
    return {
      id: `definition:${fact.path}:${definition.kind}:${definition.name}:${definition.location.line}`,
      position,
      data: { label: `${definition.kind} ${definition.name}\nline ${definition.location.line}` },
      style: { minWidth: 180 },
    } satisfies FlowNode;
  });

  const importNodes = fact.imports.map((importFact, index) => {
    const position = polar(index, Math.max(fact.imports.length, 1), IMPORT_RADIUS, 20, 160);
    return {
      id: `import:${fact.path}:${importFact.module}:${importFact.location.line}`,
      position,
      data: { label: `${importFact.module}\nline ${importFact.location.line}` },
      style: { minWidth: 150, opacity: 0.85 },
    } satisfies FlowNode;
  });

  const definitionEdges = definitionNodes.map((node) => ({ id: `edge:${rootId}:${node.id}`, source: rootId, target: node.id } satisfies FlowEdge));
  const importEdges = importNodes.map((node) => ({ id: `edge:${rootId}:${node.id}`, source: rootId, target: node.id, animated: false } satisfies FlowEdge));

  return {
    reactFlowNodes: [rootNode, ...definitionNodes, ...importNodes],
    reactFlowEdges: [...definitionEdges, ...importEdges],
    hasRenderableFacts: definitionNodes.length > 0 || importNodes.length > 0,
  };
}

function polar(index: number, count: number, radius: number, startDegrees: number, endDegrees: number): { x: number; y: number } {
  const angle = count === 1
    ? (startDegrees + endDegrees) / 2
    : startDegrees + ((endDegrees - startDegrees) * index) / Math.max(count - 1, 1);
  const radians = (angle * Math.PI) / 180;
  return {
    x: ROOT_X + Math.cos(radians) * radius,
    y: ROOT_Y + Math.sin(radians) * radius,
  };
}
```

- [ ] **Step 4: Switch the main panel into code-map mode when needed**

In `apps/viewer/src/main.tsx`, add imports:

```ts
import type { LanguageFact } from './graph';
import { buildCodeMapRenderModel } from './codeMap';
import { buildCodeMapOptions, findSelectedLanguageFact, formatLanguageLabel, type FlowSelectionOption } from './selection';
```

Add after `selectedEntryPoint`:

```ts
  const selectedLanguageFact = useMemo(() => {
    if (!graph) return null;
    return findSelectedLanguageFact(graph, selectedOption);
  }, [graph, selectedOption]);
```

Add after `flowModel`:

```ts
  const codeMapModel = useMemo(
    () => selectedLanguageFact ? buildCodeMapRenderModel(selectedLanguageFact) : null,
    [selectedLanguageFact],
  );
```

In the sidebar summary block, change the summary line and add code-map summary:

```tsx
<summary>Entry Point / Group / Code Map</summary>
```

```tsx
{selectedOption?.kind === 'group' ? <GroupSummary option={selectedOption} /> : null}
{selectedEntryPoint ? <EntryPointSummary entryPoint={selectedEntryPoint} /> : null}
{selectedLanguageFact ? <CodeMapSummary fact={selectedLanguageFact} /> : null}
```

Add the `CodeMapSummary` component near `EntryPointSummary`:

```tsx
function CodeMapSummary({ fact }: { fact: LanguageFact }) {
  return (
    <section className="summaryBlock">
      <h3>Code map file</h3>
      <p><strong>{formatLanguageLabel(fact.language)}</strong></p>
      <p><code>{fact.path}</code></p>
      <p>{fact.definitions.length} definitions · {fact.imports.length} imports · {fact.warnings.length} warnings</p>
    </section>
  );
}
```

Replace the current `selectedFlow ? ... : <p>No Execution Flow found in this graph.</p>` branch with a three-way branch:

```tsx
{selectedFlow ? (
  /* existing Execution Flow branch unchanged */
) : selectedLanguageFact && codeMapModel ? (
  codeMapModel.hasRenderableFacts ? (
    <CodeMapFactPanel fact={selectedLanguageFact} model={codeMapModel} />
  ) : (
    <p>No code-map facts to render for this file.</p>
  )
) : (
  <p>No Execution Flow or code map facts found in this graph.</p>
)}
```

Add the `CodeMapFactPanel` component below `FlowHeader`:

```tsx
function CodeMapFactPanel({
  fact,
  model,
}: {
  fact: LanguageFact;
  model: ReturnType<typeof buildCodeMapRenderModel>;
}) {
  return (
    <>
      <div className="flowHeader">
        <div>
          <p className="eyebrow">Selected code map</p>
          <h2>Code map · {formatLanguageLabel(fact.language)} · {fact.path}</h2>
          <p className="hint">Tree-sitter definitions and imports only. This is not behavior flow.</p>
        </div>
        <div className="counts">
          <span>{fact.definitions.length} definitions</span>
          <span>{fact.imports.length} imports</span>
          <span>{fact.warnings.length} warnings</span>
        </div>
      </div>
      <div className="graphCanvas" aria-label="Selected code map graph">
        <ReactFlow nodes={model.reactFlowNodes} edges={model.reactFlowEdges} fitView fitViewOptions={{ padding: 0.18 }}>
          <Background />
          <Controls />
          <MiniMap pannable zoomable />
        </ReactFlow>
      </div>
      <section className="onboardingPanel">
        <div className="onboardingHeader">
          <div>
            <h3>Code map details</h3>
            <p>Definitions and imports come from `language_facts`; warnings stay textual in this slice.</p>
          </div>
        </div>
        <div className="onboardingGrid">
          <section>
            <h4>Definitions</h4>
            {fact.definitions.length ? (
              <ol className="breadcrumbList">
                {fact.definitions.map((definition) => (
                  <li key={`${definition.kind}:${definition.name}:${definition.location.line}`}>
                    <span className="kind kind-function">{definition.kind}</span>
                    {definition.name} <code>{definition.location.path}:{definition.location.line}</code>
                  </li>
                ))}
              </ol>
            ) : <p className="hint">No definitions extracted for this file.</p>}
          </section>
          <section>
            <h4>Imports</h4>
            {fact.imports.length ? (
              <ul className="compactBullets">
                {fact.imports.map((importFact) => (
                  <li key={`${importFact.module}:${importFact.location.line}`}>
                    <code>{importFact.module}</code> · {importFact.location.path}:{importFact.location.line}
                  </li>
                ))}
              </ul>
            ) : <p className="hint">No imports extracted for this file.</p>}
          </section>
          <section>
            <h4>Warnings</h4>
            {fact.warnings.length ? (
              <ul className="compactBullets">
                {fact.warnings.map((warning) => <li key={`${warning.code}:${warning.message}`}>{warning.code} — {warning.message}</li>)}
              </ul>
            ) : <p className="hint">No parser warnings for this file.</p>}
          </section>
        </div>
      </section>
    </>
  );
}
```

Do not change `buildFlowModel()` or the existing Execution Flow branch logic.

- [ ] **Step 5: Run render-model tests and the viewer build**

Run:

```bash
bun test src/selection.test.ts src/codeMap.test.ts
bun run build
```

Working directory: `apps/viewer`

Expected: both PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/viewer/src/codeMap.tsx apps/viewer/src/codeMap.test.ts apps/viewer/src/main.tsx
git commit -m "feat: render file-centered code maps"
```

---

### Task 3: Document and verify the code-map render with HunterCake

**Files:**
- Modify: `apps/viewer/README.md`

**Interfaces:**
- Consumes:
  - `buildCodeMapOptions()` from `apps/viewer/src/selection.ts`
  - `buildCodeMapRenderModel()` from `apps/viewer/src/codeMap.tsx`
- Produces:
  - Updated viewer docs
  - Real-graph verification command for HunterCake code-map render availability

- [ ] **Step 1: Update the viewer README**

In `apps/viewer/README.md`, change the selector heading and behavior description.

Replace the section heading and first paragraph around lines 105-118 with:

```md
### Entry Point / Group / Code Map selector

Use the shared selector to choose Entry Points, grouped Entry Points, or code-map files.
Search by route, file, kind, rank, score, or `Code map`.
Python Entry Point and group selections keep the current Execution Flow graph.
Code-map file selections switch the main panel into a file-centered structural map built from `language_facts`.
```

Add a new paragraph after the grouped-option bullets:

```md
Code-map file options render one selected file at a time.
The file stays visually central, definitions are primary nodes, and imports are secondary leaf nodes.
This is structural coverage only; it is not Rust/JS/TS behavior-flow analysis.
```

Replace the first sentence under `### Graph canvas` with:

```md
The main panel renders either the selected Execution Flow or, for `Code map` selections, a file-centered structural map.
```

Add a short paragraph after the visible edge types list:

```md
For code-map selections, the canvas shows the selected file as the root node, extracted definitions as primary children, and imports as secondary leaves.
Warnings stay in the details panel instead of becoming graph nodes.
```

- [ ] **Step 2: Run focused viewer verification**

Run:

```bash
bun test src/selection.test.ts src/codeMap.test.ts
bun run build
```

Working directory: `apps/viewer`

Expected: PASS.

- [ ] **Step 3: Run the real HunterCake code-map smoke**

From `apps/viewer`, generate a real graph and assert the helper layer sees a renderable Rust map:

```bash
uv run --project /mnt/shared/Documents/Projects/AVT/packages/analyzer avt analyze /home/devgrohl/Projects/HunterCake --no-timestamp --out /tmp/huntercake-avt.json
bun -e "import fs from 'node:fs'; import { buildCodeMapOptions } from './src/selection.ts'; import { buildCodeMapRenderModel } from './src/codeMap.tsx'; const graph = JSON.parse(fs.readFileSync('/tmp/huntercake-avt.json', 'utf8')); const fact = graph.language_facts.find((item) => item.language === 'rust'); if (!fact) throw new Error('Rust language fact missing'); const options = buildCodeMapOptions(graph.language_facts); const model = buildCodeMapRenderModel(fact); if (!options.some((option) => option.id === `code_map:${fact.path}`)) throw new Error('Rust code-map option missing'); if (!model.hasRenderableFacts || model.reactFlowNodes.length < 2 || model.reactFlowEdges.length < 1) throw new Error('Rust code-map render model empty'); console.log(`Rust code-map smoke passed for ${fact.path}: ${model.reactFlowNodes.length} nodes, ${model.reactFlowEdges.length} edges.`);"
```

Expected: analyzer exits 0 and the Bun command prints a passing Rust code-map smoke line.

- [ ] **Step 4: Ponytail pass**

Inspect the final diff and cut anything beyond the slice:

- Remove any attempt to infer non-Python call edges.
- Remove any repository-wide code-map aggregation.
- Remove any new overlay/export behavior for code maps.
- Keep only selection plumbing, one-file render model, main-panel switch, docs, and tests.

- [ ] **Step 5: Commit docs and cleanup**

```bash
git add apps/viewer/README.md
git commit -m "docs: describe code map render mode"
```

- [ ] **Step 6: Final status check**

Run:

```bash
git status --short
```

Expected: no output.

Final response must include:

```text
Gate: validated viewer bun tests, viewer build, HunterCake Rust code-map smoke; ponytail pass kept one-file structural rendering only.
```
