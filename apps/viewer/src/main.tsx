import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ReactFlow, Background, Controls, MiniMap, type Edge as FlowEdge, type Node as FlowNode, type XYPosition } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import './styles.css';
import type { EntryPoint, ExecutionFlow, ExecutionFlowGraph, FlowMarker, GraphEdge, GraphNode, GuideFile } from './graph';
import { isExecutionFlowGraph, isGuideFile } from './graph';

type InspectorSelection =
  | { type: 'node'; item: GraphNode; markers: FlowMarker[] }
  | { type: 'edge'; item: GraphEdge }
  | null;

type DiagramLayout = 'hierarchy-nested' | 'hierarchy-swimlane' | 'hierarchy-outline' | 'layered' | 'circular' | 'grid';

type EdgeLabelMode = 'kind' | 'reason' | 'none';

interface EdgeFilters {
  showConfirmed: boolean;
  showUncertain: boolean;
  showRejected: boolean;
}

interface DiagramDisplayOptions {
  showHierarchyContext: boolean;
  showExternalInteractions: boolean;
  edgeLabelMode: EdgeLabelMode;
}

interface FlowSelectionOption {
  id: string;
  label: string;
  kind: 'entry' | 'group';
  entryPointIds: string[];
}

type PositionOverrides = Record<string, Record<string, XYPosition>>;
type SizeOverrides = Record<string, Record<string, { width: number; height: number }>>;

function App() {
  const [graph, setGraph] = useState<ExecutionFlowGraph | null>(null);
  const [guide, setGuide] = useState<GuideFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedSelectionId, setSelectedSelectionId] = useState<string>('');
  const [selection, setSelection] = useState<InspectorSelection>(null);
  const [positionOverrides, setPositionOverrides] = useState<PositionOverrides>({});
  const [sizeOverrides, setSizeOverrides] = useState<SizeOverrides>({});
  const [edgeFilters, setEdgeFilters] = useState<EdgeFilters>({ showConfirmed: true, showUncertain: true, showRejected: false });
  const [diagramLayout, setDiagramLayout] = useState<DiagramLayout>('hierarchy-swimlane');
  const [displayOptions, setDisplayOptions] = useState<DiagramDisplayOptions>({
    showHierarchyContext: true,
    showExternalInteractions: true,
    edgeLabelMode: 'kind',
  });

  useEffect(() => {
    loadSampleGraph()
      .then((sample) => {
        setGraph(sample);
        setSelectedSelectionId(defaultSelectionId(sample));
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)));
  }, []);

  const selectionOptions = useMemo(() => graph ? buildSelectionOptions(graph) : [], [graph]);

  const selectedOption = useMemo(() => {
    if (!selectionOptions.length) return null;
    return selectionOptions.find((option) => option.id === selectedSelectionId) ?? selectionOptions[0];
  }, [selectionOptions, selectedSelectionId]);

  const selectedFlow = useMemo(() => {
    if (!graph || !selectedOption) return null;
    return buildSelectedFlow(graph, selectedOption);
  }, [graph, selectedOption]);

  const selectedEntryPoint = useMemo(() => {
    if (!graph || !selectedOption || selectedOption.kind !== 'entry') return null;
    return graph.entry_points.find((entry) => entry.id === selectedOption.entryPointIds[0]) ?? null;
  }, [graph, selectedOption]);

  const flowModel = useMemo(() => {
    if (!graph || !selectedFlow) return emptyFlowModel();
    return buildFlowModel(graph, selectedFlow, edgeFilters, diagramLayout, displayOptions);
  }, [graph, selectedFlow, edgeFilters, diagramLayout, displayOptions]);

  const editKey = selectedFlow ? layoutEditKey(selectedFlow.id, diagramLayout, displayOptions) : '';
  const currentOverrides = editKey ? positionOverrides[editKey] ?? {} : {};
  const currentSizeOverrides = editKey ? sizeOverrides[editKey] ?? {} : {};
  const editedNodeCount = new Set([...Object.keys(currentOverrides), ...Object.keys(currentSizeOverrides)]).size;
  const displayedReactFlowNodes = useMemo(
    () => flowModel.reactFlowNodes.map((node) => {
      const positioned = currentOverrides[node.id] ? { ...node, position: currentOverrides[node.id] } : { ...node };
      const size = currentSizeOverrides[node.id];
      if (!size) return positioned;
      return { ...positioned, style: { ...positioned.style, width: size.width, height: size.height } };
    }),
    [flowModel.reactFlowNodes, currentOverrides, currentSizeOverrides],
  );

  async function handleGuideSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setError(null);
    try {
      setGuide(parseGuide(await file.text()));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  async function handleFileSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setError(null);
    setSelection(null);
    try {
      const nextGraph = await parseGraph(await file.text());
      setGraph(nextGraph);
      setPositionOverrides({});
      setSizeOverrides({});
      setSelectedSelectionId(defaultSelectionId(nextGraph));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  return (
    <main className="shell">
      <header className="header">
        <div>
          <p className="eyebrow">Architecture Visualizer Tool</p>
          <h1>Execution Flow Viewer</h1>
        </div>
        <div className="fileActions">
          <label className="filePicker">
            Load graph JSON
            <input type="file" accept="application/json,.json" onChange={handleFileSelected} />
          </label>
          <label className="filePicker secondaryPicker">
            Load guide JSON
            <input type="file" accept="application/json,.json" onChange={handleGuideSelected} />
          </label>
        </div>
      </header>

      {error ? <section className="error">{error}</section> : null}
      {graph ? (
        <section className="layout">
          <aside className="panel sidebar">
            <GraphSummary graph={graph} />

            <label className="selectLabel" htmlFor="entryPoint">Selected Entry Point / Group</label>
            <select
              id="entryPoint"
              value={selectedOption?.id ?? ''}
              onChange={(event) => {
                setSelectedSelectionId(event.target.value);
                setSelection(null);
              }}
            >
              {selectionOptions.map((option) => (
                <option key={option.id} value={option.id}>{option.label}</option>
              ))}
            </select>

            {selectedOption?.kind === 'group' ? <GroupSummary option={selectedOption} /> : null}
            {selectedEntryPoint ? <EntryPointSummary entryPoint={selectedEntryPoint} /> : null}
            <DiagramLayoutControls layout={diagramLayout} onChange={setDiagramLayout} />
            <DiagramDisplayControls options={displayOptions} onChange={setDisplayOptions} />
            <EdgeFilterControls filters={edgeFilters} onChange={setEdgeFilters} />
            <GuideSummary
              guide={guide}
              graph={graph}
              selectedSelectionId={selectedSelectionId}
              onSelectEntry={(entryId) => {
                setSelectedSelectionId(`entry:${entryId}`);
                setSelection(null);
              }}
            />
            <Inspector
              selection={selection}
              size={selection?.type === 'node' ? currentSizeForNode(selection.item, displayedReactFlowNodes) : undefined}
              onResize={(node, delta) => {
                if (!editKey) return;
                const currentSize = currentSizeForNode(node, displayedReactFlowNodes) ?? defaultNodeSize(node);
                setSizeOverrides((previous) => ({
                  ...previous,
                  [editKey]: {
                    ...(previous[editKey] ?? {}),
                    [node.id]: {
                      width: Math.max(160, currentSize.width + delta.width),
                      height: Math.max(96, currentSize.height + delta.height),
                    },
                  },
                }));
              }}
            />
          </aside>

          <section className="panel flowPanel">
            {selectedFlow ? (
              <>
                <FlowHeader
                  flow={selectedFlow}
                  label={selectedOption?.label ?? selectedFlow.id}
                  nodeCount={flowModel.flowNodes.length}
                  edgeCount={flowModel.flowEdges.length}
                  layout={diagramLayout}
                  editedNodeCount={editedNodeCount}
                  onResetLayout={() => {
                    if (!editKey) return;
                    setPositionOverrides((previous) => {
                      const next = { ...previous };
                      delete next[editKey];
                      return next;
                    });
                    setSizeOverrides((previous) => {
                      const next = { ...previous };
                      delete next[editKey];
                      return next;
                    });
                  }}
                />
                <div className="graphCanvas" aria-label="Selected Execution Flow graph">
                  <ReactFlow
                    key={`${selectedFlow.id}:${diagramLayout}:${displayOptions.showHierarchyContext}:${displayOptions.showExternalInteractions}:${displayOptions.edgeLabelMode}`}
                    nodes={displayedReactFlowNodes}
                    edges={flowModel.reactFlowEdges}
                    fitView
                    fitViewOptions={{ padding: 0.18 }}
                    onNodeClick={(_: React.MouseEvent, node: FlowNode) => {
                      const graphNode = flowModel.nodeById.get(String(node.id));
                      if (graphNode) setSelection({ type: 'node', item: graphNode, markers: flowModel.markersByNodeId.get(graphNode.id) ?? [] });
                    }}
                    onNodeDragStop={(_, node: FlowNode) => {
                      if (!editKey) return;
                      setPositionOverrides((previous) => ({
                        ...previous,
                        [editKey]: {
                          ...(previous[editKey] ?? {}),
                          [String(node.id)]: node.position,
                        },
                      }));
                    }}
                    onEdgeClick={(_: React.MouseEvent, edge: FlowEdge) => {
                      const graphEdge = flowModel.edgeById.get(String(edge.id));
                      if (graphEdge) setSelection({ type: 'edge', item: graphEdge });
                    }}
                  >
                    <Background />
                    <Controls />
                    <MiniMap pannable zoomable />
                  </ReactFlow>
                </div>
                <FlowLists nodes={flowModel.flowNodes} edges={flowModel.flowEdges} markersByNodeId={flowModel.markersByNodeId} />
              </>
            ) : (
              <p>No Execution Flow found in this graph.</p>
            )}
          </section>
        </section>
      ) : (
        <section className="panel">Loading sample graph…</section>
      )}
    </main>
  );
}

function GraphSummary({ graph }: { graph: ExecutionFlowGraph }) {
  const secretWarnings = graph.warnings.filter((warning) => warning.code === 'secret_literal_redacted').length;
  return (
    <>
      <h2>{graph.metadata.project_name}</h2>
      <dl className="metadata">
        <div><dt>Schema</dt><dd>{graph.metadata.schema_version}</dd></div>
        <div><dt>Analyzer</dt><dd>{graph.metadata.analyzer_version}</dd></div>
        <div><dt>Entry Points</dt><dd>{graph.entry_points.length}</dd></div>
        <div><dt>Flows</dt><dd>{graph.flows.length}</dd></div>
        <div><dt>Warnings</dt><dd>{graph.warnings.length}</dd></div>
        <div><dt>Secret warnings</dt><dd>{secretWarnings}</dd></div>
      </dl>
    </>
  );
}

function GroupSummary({ option }: { option: FlowSelectionOption }) {
  return (
    <section className="summaryBlock">
      <h3>Entry Point Group</h3>
      <p><strong>{option.label}</strong></p>
      <p>{option.entryPointIds.length} Entry Points combined.</p>
    </section>
  );
}

function EntryPointSummary({ entryPoint }: { entryPoint: EntryPoint }) {
  return (
    <section className="summaryBlock">
      <h3>Entry Point</h3>
      <p><strong>{entryPoint.kind}</strong></p>
      {entryPoint.http_methods?.length || entryPoint.route_path ? (
        <p><code>{entryPoint.http_methods?.join(', ') || 'ROUTE'} {entryPoint.route_path ?? '?'}</code></p>
      ) : null}
      <p>{entryPoint.evidence.location.path}:{entryPoint.evidence.location.line}</p>
      <p>{entryPoint.evidence.reason.label}</p>
    </section>
  );
}

function DiagramLayoutControls({ layout, onChange }: { layout: DiagramLayout; onChange: (layout: DiagramLayout) => void }) {
  return (
    <section className="summaryBlock">
      <h3>Diagram layout</h3>
      <label className="selectLabel" htmlFor="diagramLayout">Handling</label>
      <select id="diagramLayout" value={layout} onChange={(event) => onChange(event.target.value as DiagramLayout)}>
        <option value="hierarchy-nested">Nested ownership map</option>
        <option value="hierarchy-swimlane">Swimlane hierarchy</option>
        <option value="hierarchy-outline">Outline + focused graph</option>
        <option value="layered">Layered flow</option>
        <option value="circular">Circular relationships</option>
        <option value="grid">Compact grid</option>
      </select>
      <p className="hint">Switch layouts to inspect dense flows from different angles.</p>
    </section>
  );
}

function DiagramDisplayControls({ options, onChange }: { options: DiagramDisplayOptions; onChange: (options: DiagramDisplayOptions) => void }) {
  return (
    <section className="summaryBlock">
      <h3>Diagram handling</h3>
      <label className="checkbox">
        <input type="checkbox" checked={options.showHierarchyContext} onChange={(event) => onChange({ ...options, showHierarchyContext: event.target.checked })} />
        Show module/class context
      </label>
      <label className="checkbox">
        <input type="checkbox" checked={options.showExternalInteractions} onChange={(event) => onChange({ ...options, showExternalInteractions: event.target.checked })} />
        Show External Interactions
      </label>
      <label className="selectLabel" htmlFor="edgeLabels">Edge labels</label>
      <select id="edgeLabels" value={options.edgeLabelMode} onChange={(event) => onChange({ ...options, edgeLabelMode: event.target.value as EdgeLabelMode })}>
        <option value="kind">Kind</option>
        <option value="reason">Reason</option>
        <option value="none">None</option>
      </select>
    </section>
  );
}

function GuideSummary({
  guide,
  graph,
  selectedSelectionId,
  onSelectEntry,
}: {
  guide: GuideFile | null;
  graph: ExecutionFlowGraph;
  selectedSelectionId: string;
  onSelectEntry: (entryId: string) => void;
}) {
  if (!guide) {
    return (
      <section className="summaryBlock">
        <h3>Guide</h3>
        <p className="hint">Load a Phase 2 guide JSON file to inspect suggested Entry Points and reasons.</p>
      </section>
    );
  }

  const entryByRef = buildEntryRefIndex(graph);
  return (
    <section className="summaryBlock guidePanel">
      <h3>Guide suggestions</h3>
      {guide.project_observations.length ? (
        <ul className="compactList">
          {guide.project_observations.map((observation, index) => <li key={index}>{observation}</li>)}
        </ul>
      ) : null}
      <ul className="guideList">
        {guide.suggested_entry_points.map((suggestion) => {
          const entryPoint = entryByRef.get(suggestion.entry);
          const isSelected = entryPoint ? selectedSelectionId === `entry:${entryPoint.id}` : false;
          return (
            <li key={`${suggestion.entry}:${suggestion.kind}`} className={isSelected ? 'selectedGuideSuggestion' : undefined}>
              <span className={`certainty certainty-${suggestion.confidence === 'high' ? 'confirmed' : suggestion.confidence === 'medium' ? 'uncertain' : 'rejected'}`}>{suggestion.confidence}</span>
              <strong>{suggestion.entry}</strong>
              <p>{suggestion.reason}</p>
              <p className="hint">Risk: {suggestion.risk}</p>
              {entryPoint ? (
                <button className="linkButton" type="button" onClick={() => onSelectEntry(entryPoint.id)}>Show flow</button>
              ) : (
                <p className="hint">No matching graph Entry Point loaded.</p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function EdgeFilterControls({ filters, onChange }: { filters: EdgeFilters; onChange: (filters: EdgeFilters) => void }) {
  return (
    <section className="summaryBlock">
      <h3>Edge filters</h3>
      <label className="checkbox"><input type="checkbox" checked={filters.showConfirmed} onChange={(event) => onChange({ ...filters, showConfirmed: event.target.checked })} /> Confirmed</label>
      <label className="checkbox"><input type="checkbox" checked={filters.showUncertain} onChange={(event) => onChange({ ...filters, showUncertain: event.target.checked })} /> Uncertain</label>
      <label className="checkbox"><input type="checkbox" checked={filters.showRejected} onChange={(event) => onChange({ ...filters, showRejected: event.target.checked })} /> Rejected</label>
    </section>
  );
}

function layoutEditKey(flowId: string, layout: DiagramLayout, options: DiagramDisplayOptions): string {
  return `${flowId}:${layout}:context=${options.showHierarchyContext}:external=${options.showExternalInteractions}:labels=${options.edgeLabelMode}`;
}

function FlowHeader({
  flow,
  label,
  nodeCount,
  edgeCount,
  layout,
  editedNodeCount,
  onResetLayout,
}: {
  flow: ExecutionFlow;
  label: string;
  nodeCount: number;
  edgeCount: number;
  layout: DiagramLayout;
  editedNodeCount: number;
  onResetLayout: () => void;
}) {
  return (
    <div className="flowHeader">
      <div>
        <p className="eyebrow">Selected Execution Flow</p>
        <h2>{label}</h2>
        <p className="hint">{layoutDescription(layout)}</p>
      </div>
      <div className="counts">
        <span>{nodeCount} visible nodes</span>
        <span>{edgeCount} visible edges</span>
        <span>{flow.marker_ids.length} markers</span>
        {editedNodeCount ? <span>{editedNodeCount} edited</span> : null}
        <button className="linkButton" type="button" onClick={onResetLayout} disabled={!editedNodeCount}>Reset layout</button>
      </div>
    </div>
  );
}

function layoutDescription(layout: DiagramLayout): string {
  if (layout === 'hierarchy-nested') return 'Nested ownership map: modules/classes are areas that own their functions and methods.';
  if (layout === 'hierarchy-swimlane') return 'Swimlane hierarchy: each module becomes a lane, preserving ownership while reducing overlap.';
  if (layout === 'hierarchy-outline') return 'Outline + focused graph: hierarchy is a compact left outline; behavior flow stays on the main canvas.';
  if (layout === 'layered') return 'Layered flow: call-flow columns with structural context areas when enabled.';
  if (layout === 'circular') return 'Circular: relationship overview for spotting clusters and cycles.';
  return 'Compact grid: dense scan-friendly layout.';
}

function FlowLists({ nodes, edges, markersByNodeId }: { nodes: GraphNode[]; edges: GraphEdge[]; markersByNodeId: Map<string, FlowMarker[]> }) {
  const nodePreview = nodes.slice(0, 8);
  const edgePreview = edges.slice(0, 8);
  return (
    <details className="lowerLists compactDetails">
      <summary>Visible details ({nodes.length} nodes, {edges.length} edges)</summary>
      <div className="columns compactDetailsBody">
        <section>
          <h3>Nodes preview</h3>
          <ul className="itemList compactItems">
            {nodePreview.map((node) => (
              <li key={node.id}>
                <span className={`kind kind-${node.kind}`}>{node.kind}</span>
                <strong>{node.label}</strong>
                {(markersByNodeId.get(node.id) ?? []).length > 0 ? <p>{markersByNodeId.get(node.id)?.length} Flow Marker(s)</p> : null}
              </li>
            ))}
          </ul>
          {nodes.length > nodePreview.length ? <p className="hint">Showing first {nodePreview.length}; use graph/inspector for primary navigation.</p> : null}
        </section>
        <section>
          <h3>Edges preview</h3>
          <ul className="itemList compactItems">
            {edgePreview.map((edge) => (
              <li key={edge.id}>
                <span className={`certainty certainty-${edge.certainty}`}>{edge.certainty}</span>
                <strong>{edge.kind}</strong>
                <p>{edge.evidence.reason.label}</p>
              </li>
            ))}
          </ul>
          {edges.length > edgePreview.length ? <p className="hint">Showing first {edgePreview.length}; click graph edges for details.</p> : null}
        </section>
      </div>
    </details>
  );
}

function Inspector({
  selection,
  size,
  onResize,
}: {
  selection: InspectorSelection;
  size?: { width: number; height: number };
  onResize: (node: GraphNode, delta: { width: number; height: number }) => void;
}) {
  if (!selection) {
    return (
      <section className="summaryBlock inspector">
        <h3>Inspector</h3>
        <p>Click a node or edge in the graph.</p>
      </section>
    );
  }

  if (selection.type === 'node') {
    return (
      <section className="summaryBlock inspector">
        <h3>Node</h3>
        <p><span className={`kind kind-${selection.item.kind}`}>{selection.item.kind}</span></p>
        <p><strong>{selection.item.label}</strong></p>
        {selection.item.path ? <p>{selection.item.path}</p> : null}
        {selection.item.qualified_name ? <code>{selection.item.qualified_name}</code> : null}
        {selection.item.signature ? <code>{selection.item.signature}</code> : null}
        {selection.item.kind === 'module' || selection.item.kind === 'class' ? (
          <div className="resizeControls">
            <h4>Container size</h4>
            {size ? <p className="hint">{Math.round(size.width)} × {Math.round(size.height)}</p> : null}
            <div className="resizeButtonGrid">
              <button className="linkButton" type="button" onClick={() => onResize(selection.item, { width: 80, height: 0 })}>Wider</button>
              <button className="linkButton" type="button" onClick={() => onResize(selection.item, { width: -80, height: 0 })}>Narrower</button>
              <button className="linkButton" type="button" onClick={() => onResize(selection.item, { width: 0, height: 80 })}>Taller</button>
              <button className="linkButton" type="button" onClick={() => onResize(selection.item, { width: 0, height: -80 })}>Shorter</button>
            </div>
          </div>
        ) : null}
        {selection.markers.length ? (
          <>
            <h4>Flow Markers</h4>
            <ul>
              {selection.markers.map((marker) => <li key={marker.id}>{marker.kind} at line {marker.evidence.location.line}</li>)}
            </ul>
          </>
        ) : null}
      </section>
    );
  }

  return (
    <section className="summaryBlock inspector">
      <h3>Edge</h3>
      <p><span className={`certainty certainty-${selection.item.certainty}`}>{selection.item.certainty}</span></p>
      <p><strong>{selection.item.kind}</strong></p>
      <p>{selection.item.evidence.reason.label}</p>
      <p>{selection.item.evidence.location.path}:{selection.item.evidence.location.line}</p>
    </section>
  );
}

function currentSizeForNode(node: GraphNode, reactFlowNodes: FlowNode[]): { width: number; height: number } | undefined {
  const flowNode = reactFlowNodes.find((item) => item.id === node.id);
  const width = typeof flowNode?.style?.width === 'number' ? flowNode.style.width : undefined;
  const height = typeof flowNode?.style?.height === 'number' ? flowNode.style.height : undefined;
  if (width === undefined || height === undefined) return undefined;
  return { width, height };
}

function entryImportanceScore(graph: ExecutionFlowGraph, entry: EntryPoint): number {
  const flow = graph.flows.find((item) => item.entry_point_id === entry.id);
  const label = entry.label.toLowerCase();
  const route = (entry.route_path ?? '').toLowerCase();
  const methods = new Set(entry.http_methods ?? []);
  let score = flow ? Math.min(flow.edge_ids.length, 30) : 0;

  if (entry.kind === 'framework_hook') score += 100;
  else if (entry.kind === 'web_route') score += 60;
  else if (entry.kind === 'cli_command') score += 45;
  else if (entry.kind === 'script') score += 35;

  if (['auth', 'login', 'token', 'user', 'session', 'current_user'].some((token) => label.includes(token) || route.includes(token))) score += 35;
  if (['seed', 'toggle', 'search', 'publish', 'callback'].some((token) => label.includes(token) || route.includes(token))) score += 25;
  if (['POST', 'PUT', 'PATCH', 'DELETE'].some((method) => methods.has(method))) score += 15;
  return score;
}

function buildEntryRefIndex(graph: ExecutionFlowGraph): Map<string, EntryPoint> {
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const index = new Map<string, EntryPoint>();
  for (const entry of graph.entry_points) {
    const node = nodeById.get(entry.node_id);
    if (!node?.path || !node.qualified_name) continue;
    index.set(`${node.path}:${node.qualified_name}`, entry);
  }
  return index;
}

function defaultSelectionId(graph: ExecutionFlowGraph): string {
  const rankedEntry = [...graph.entry_points].sort((a, b) => entryImportanceScore(graph, b) - entryImportanceScore(graph, a) || a.id.localeCompare(b.id))[0];
  return rankedEntry ? `entry:${rankedEntry.id}` : buildSelectionOptions(graph)[0]?.id ?? '';
}

function buildSelectionOptions(graph: ExecutionFlowGraph): FlowSelectionOption[] {
  const entryOptions: FlowSelectionOption[] = [...graph.entry_points]
    .sort((a, b) => entryImportanceScore(graph, b) - entryImportanceScore(graph, a) || a.id.localeCompare(b.id))
    .map((entry) => ({
      id: `entry:${entry.id}`,
      label: entry.label,
      kind: 'entry',
      entryPointIds: [entry.id],
    }));

  const webRoutes = graph.entry_points.filter((entry) => entry.kind === 'web_route');
  const groupOptions: FlowSelectionOption[] = [];
  const byKind = groupBy(graph.entry_points, (entry) => entry.kind);
  const byDirectory = groupBy(webRoutes, (entry) => directoryName(entry.evidence.location.path));
  const byFile = groupBy(webRoutes, (entry) => entry.evidence.location.path);

  for (const [kind, entries] of [...byKind.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (entries.length < 2) continue;
    groupOptions.push({
      id: `group:kind:${kind}`,
      label: `All ${kind} Entry Points (${entries.length})`,
      kind: 'group',
      entryPointIds: entries.map((entry) => entry.id).sort(),
    });
  }

  for (const [directory, entries] of [...byDirectory.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (entries.length < 2) continue;
    groupOptions.push({
      id: `group:dir:${directory}`,
      label: `All web routes in ${directory}/* (${entries.length})`,
      kind: 'group',
      entryPointIds: entries.map((entry) => entry.id).sort(),
    });
  }

  for (const [file, entries] of [...byFile.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (entries.length < 2) continue;
    groupOptions.push({
      id: `group:file:${file}`,
      label: `All web routes in ${file} (${entries.length})`,
      kind: 'group',
      entryPointIds: entries.map((entry) => entry.id).sort(),
    });
  }

  return [...groupOptions, ...entryOptions];
}

function buildSelectedFlow(graph: ExecutionFlowGraph, option: FlowSelectionOption): ExecutionFlow | null {
  const flowsByEntryPointId = new Map(graph.flows.map((flow) => [flow.entry_point_id, flow]));
  const selectedFlows = option.entryPointIds.map((entryPointId) => flowsByEntryPointId.get(entryPointId)).filter((flow): flow is ExecutionFlow => Boolean(flow));
  if (!selectedFlows.length) return null;
  if (option.kind === 'entry') return selectedFlows[0];

  return {
    id: option.id,
    entry_point_id: option.id,
    node_ids: sortedUnique(selectedFlows.flatMap((flow) => flow.node_ids)),
    edge_ids: sortedUnique(selectedFlows.flatMap((flow) => flow.edge_ids)),
    marker_ids: sortedUnique(selectedFlows.flatMap((flow) => flow.marker_ids)),
  };
}

function groupBy<T>(items: T[], keyFn: (item: T) => string): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const item of items) {
    const key = keyFn(item);
    grouped.set(key, [...(grouped.get(key) ?? []), item]);
  }
  return grouped;
}

function directoryName(path: string): string {
  const index = path.lastIndexOf('/');
  return index === -1 ? '.' : path.slice(0, index);
}

function sortedUnique(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function buildFlowModel(
  graph: ExecutionFlowGraph,
  flow: ExecutionFlow,
  filters: EdgeFilters,
  layout: DiagramLayout,
  displayOptions: DiagramDisplayOptions,
) {
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const edgeById = new Map(graph.edges.map((edge) => [edge.id, edge]));
  const markerById = new Map(graph.markers.map((marker) => [marker.id, marker]));

  const visibleEdgeIds = new Set(
    flow.edge_ids.filter((edgeId) => {
      const edge = edgeById.get(edgeId);
      if (!edge) return false;
      if (!displayOptions.showExternalInteractions && edge.kind === 'external_interaction') return false;
      if (edge.certainty === 'confirmed') return filters.showConfirmed;
      if (edge.certainty === 'uncertain') return filters.showUncertain;
      return filters.showRejected;
    }),
  );

  const flowNodeIds = new Set(flow.node_ids);
  for (const edgeId of visibleEdgeIds) {
    const edge = edgeById.get(edgeId);
    if (edge) {
      flowNodeIds.add(edge.source);
      flowNodeIds.add(edge.target);
    }
  }

  if (displayOptions.showHierarchyContext) {
    for (const nodeId of [...flowNodeIds]) {
      let current = nodeById.get(nodeId);
      while (current?.parent_id) {
        flowNodeIds.add(current.parent_id);
        current = nodeById.get(current.parent_id);
      }
    }
  }

  if (!displayOptions.showExternalInteractions) {
    for (const nodeId of [...flowNodeIds]) {
      if (nodeById.get(nodeId)?.kind === 'external') flowNodeIds.delete(nodeId);
    }
  }

  const flowNodes = [...flowNodeIds].map((id) => nodeById.get(id)).filter((node): node is GraphNode => Boolean(node)).sort(compareHierarchyNodes);
  const flowEdges = [...visibleEdgeIds].map((id) => edgeById.get(id)).filter((edge): edge is GraphEdge => Boolean(edge)).sort((a, b) => a.id.localeCompare(b.id));
  const flowMarkers = flow.marker_ids.map((id) => markerById.get(id)).filter((marker): marker is FlowMarker => Boolean(marker));

  const markersByNodeId = new Map<string, FlowMarker[]>();
  for (const marker of flowMarkers) {
    if (!marker.node_id) continue;
    markersByNodeId.set(marker.node_id, [...(markersByNodeId.get(marker.node_id) ?? []), marker]);
  }

  const layoutModel = diagramLayoutModel(flowNodes, flowEdges, nodeById, layout, displayOptions.showHierarchyContext);
  const reactFlowNodes = flowNodes.map((node): FlowNode => {
    const parentId = layoutModel.parentIds.get(node.id);
    return {
      id: node.id,
      position: layoutModel.positions.get(node.id) ?? { x: 0, y: 0 },
      parentId,
      extent: parentId ? 'parent' : undefined,
      data: {
        label: `${node.kind}: ${node.label}${markersByNodeId.has(node.id) ? ` • ${markersByNodeId.get(node.id)?.length} marker(s)` : ''}`,
      },
      type: 'default',
      style: nodeStyle(node, layoutModel.sizes.get(node.id)),
      zIndex: node.kind === 'module' ? 0 : node.kind === 'class' ? 1 : 2,
    };
  });

  const reactFlowEdges = flowEdges.map((edge): FlowEdge => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    label: edgeLabel(edge, displayOptions.edgeLabelMode),
    animated: edge.kind === 'await' || edge.kind === 'external_interaction',
    style: edgeStyle(edge),
  }));

  return { flowNodes, flowEdges, reactFlowNodes, reactFlowEdges, nodeById, edgeById, markersByNodeId };
}

function emptyFlowModel() {
  return {
    flowNodes: [] as GraphNode[],
    flowEdges: [] as GraphEdge[],
    reactFlowNodes: [] as FlowNode[],
    reactFlowEdges: [] as FlowEdge[],
    nodeById: new Map<string, GraphNode>(),
    edgeById: new Map<string, GraphEdge>(),
    markersByNodeId: new Map<string, FlowMarker[]>(),
  };
}

function compareHierarchyNodes(a: GraphNode, b: GraphNode): number {
  return hierarchySortKey(a).localeCompare(hierarchySortKey(b));
}

function hierarchySortKey(node: GraphNode): string {
  const path = node.path ?? '~external';
  const kindOrder = node.kind === 'module' ? '0' : node.kind === 'class' ? '1' : node.kind === 'function' || node.kind === 'method' ? '2' : '3';
  return `${path}:${kindOrder}:${node.parent_id ?? ''}:${node.qualified_name ?? node.label}:${node.id}`;
}

interface DiagramLayoutModel {
  positions: Map<string, { x: number; y: number }>;
  parentIds: Map<string, string>;
  sizes: Map<string, { width: number; height: number }>;
}

function diagramLayoutModel(
  nodes: GraphNode[],
  edges: GraphEdge[],
  nodeById: Map<string, GraphNode>,
  layout: DiagramLayout,
  showHierarchyContext: boolean,
): DiagramLayoutModel {
  if (layout === 'hierarchy-nested') {
    const positions = hierarchyPositions(nodes, nodeById);
    return showHierarchyContext ? areaLayout(nodes, nodeById, positions) : emptyLayoutModel(positions);
  }
  if (layout === 'hierarchy-swimlane') {
    const positions = swimlaneHierarchyPositions(nodes, nodeById);
    return showHierarchyContext ? areaLayout(nodes, nodeById, positions) : emptyLayoutModel(positions);
  }
  if (layout === 'hierarchy-outline') return emptyLayoutModel(outlineFocusedPositions(nodes, edges, nodeById));
  if (layout === 'circular') return emptyLayoutModel(circularPositions(nodes));
  if (layout === 'grid') return emptyLayoutModel(gridPositions(nodes));
  const positions = layeredPositions(nodes, edges, nodeById);
  return showHierarchyContext ? areaLayout(nodes, nodeById, positions) : emptyLayoutModel(positions);
}

function emptyLayoutModel(positions: Map<string, { x: number; y: number }>): DiagramLayoutModel {
  return { positions, parentIds: new Map(), sizes: new Map() };
}

function areaLayout(
  nodes: GraphNode[],
  nodeById: Map<string, GraphNode>,
  absolute: Map<string, { x: number; y: number }>,
): DiagramLayoutModel {
  const visibleIds = new Set(nodes.map((node) => node.id));
  const parentIds = new Map<string, string>();
  const sizes = new Map<string, { width: number; height: number }>();
  const absoluteAreas = new Map(absolute);
  const positions = new Map(absolute);

  for (const node of nodes) {
    if (!node.parent_id || !visibleIds.has(node.parent_id)) continue;
    const parent = nodeById.get(node.parent_id);
    if (parent?.kind === 'module' || parent?.kind === 'class') parentIds.set(node.id, parent.id);
  }

  const containers = nodes.filter((node) => node.kind === 'class' || node.kind === 'module').sort((a, b) => containerDepth(b, nodeById) - containerDepth(a, nodeById));
  for (const container of containers) {
    const children = nodes.filter((node) => parentIds.get(node.id) === container.id);
    const minimum = defaultNodeSize(container);
    if (!children.length) {
      sizes.set(container.id, minimum);
      continue;
    }

    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (const child of children) {
      const position = absoluteAreas.get(child.id) ?? absolute.get(child.id) ?? { x: 0, y: 0 };
      const childSize = sizes.get(child.id) ?? defaultNodeSize(child);
      minX = Math.min(minX, position.x);
      minY = Math.min(minY, position.y);
      maxX = Math.max(maxX, position.x + childSize.width);
      maxY = Math.max(maxY, position.y + childSize.height);
    }

    const padding = container.kind === 'module' ? { x: 44, top: 72, bottom: 36 } : { x: 28, top: 60, bottom: 28 };
    const nextAbsolute = {
      x: Math.min(absolute.get(container.id)?.x ?? minX - padding.x, minX - padding.x),
      y: Math.min(absolute.get(container.id)?.y ?? minY - padding.top, minY - padding.top),
    };
    const width = Math.max(minimum.width, maxX - nextAbsolute.x + padding.x);
    const height = Math.max(minimum.height, maxY - nextAbsolute.y + padding.bottom);
    absoluteAreas.set(container.id, nextAbsolute);
    positions.set(container.id, nextAbsolute);
    sizes.set(container.id, { width, height });
  }

  for (const node of nodes) {
    const parentId = parentIds.get(node.id);
    if (!parentId) continue;
    const parentPosition = absoluteAreas.get(parentId) ?? { x: 0, y: 0 };
    const nodePosition = absoluteAreas.get(node.id) ?? absolute.get(node.id) ?? { x: 0, y: 0 };
    positions.set(node.id, {
      x: Math.max(20, nodePosition.x - parentPosition.x),
      y: Math.max(48, nodePosition.y - parentPosition.y),
    });
  }

  avoidTopLevelContainerOverlap(nodes, parentIds, positions, sizes);

  return { positions, parentIds, sizes };
}

function avoidTopLevelContainerOverlap(
  nodes: GraphNode[],
  parentIds: Map<string, string>,
  positions: Map<string, { x: number; y: number }>,
  sizes: Map<string, { width: number; height: number }>,
): void {
  const containers = nodes
    .filter((node) => (node.kind === 'module' || node.kind === 'class') && !parentIds.has(node.id))
    .sort((a, b) => (positions.get(a.id)?.y ?? 0) - (positions.get(b.id)?.y ?? 0) || a.id.localeCompare(b.id));
  let cursorY = Number.NEGATIVE_INFINITY;
  for (const container of containers) {
    const position = positions.get(container.id) ?? { x: 0, y: 0 };
    const size = sizes.get(container.id) ?? defaultNodeSize(container);
    const nextY = cursorY === Number.NEGATIVE_INFINITY ? position.y : Math.max(position.y, cursorY + 72);
    positions.set(container.id, { ...position, y: nextY });
    cursorY = nextY + size.height;
  }
}

function defaultNodeSize(node: GraphNode): { width: number; height: number } {
  if (node.kind === 'module') return { width: 300, height: 132 };
  if (node.kind === 'class') return { width: 260, height: 120 };
  return { width: 220, height: 72 };
}

function containerDepth(node: GraphNode, nodeById: Map<string, GraphNode>): number {
  let depth = 0;
  let current = node;
  while (current.parent_id) {
    depth += 1;
    const parent = nodeById.get(current.parent_id);
    if (!parent) break;
    current = parent;
  }
  return depth;
}

function swimlaneHierarchyPositions(nodes: GraphNode[], nodeById: Map<string, GraphNode>): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  const modules = nodes.filter((node) => node.kind === 'module').sort(compareHierarchyNodes);
  const internals = nodes.filter((node) => node.kind !== 'module' && node.kind !== 'external');
  const externals = nodes.filter((node) => node.kind === 'external').sort(compareHierarchyNodes);
  let laneY = 0;

  for (const module of modules) {
    const descendants = internals.filter((node) => hasAncestor(node, module.id, nodeById) || node.parent_id === module.id).sort(compareHierarchyNodes);
    const laneHeight = Math.max(220, descendants.length * 110 + 120);
    positions.set(module.id, { x: 0, y: laneY });

    const moduleFunctions = descendants.filter((node) => (node.kind === 'function' || node.kind === 'method') && directModuleParent(node, module.id, nodeById));
    moduleFunctions.forEach((node, index) => positions.set(node.id, { x: 360 + (index % 3) * 280, y: laneY + 90 + Math.floor(index / 3) * 120 }));

    const classes = descendants.filter((node) => node.kind === 'class');
    let classY = laneY + 90 + Math.ceil(moduleFunctions.length / 3) * 120;
    for (const cls of classes) {
      positions.set(cls.id, { x: 320, y: classY });
      const members = descendants.filter((node) => (node.kind === 'function' || node.kind === 'method') && hasAncestor(node, cls.id, nodeById));
      members.forEach((member, index) => positions.set(member.id, { x: 620 + (index % 2) * 280, y: classY + 80 + Math.floor(index / 2) * 110 }));
      classY += Math.max(150, Math.ceil(members.length / 2) * 110 + 120);
    }

    laneY += Math.max(laneHeight, classY - laneY) + 96;
  }

  const positioned = new Set(positions.keys());
  internals.filter((node) => !positioned.has(node.id)).forEach((node, index) => positions.set(node.id, { x: 360, y: laneY + index * 120 }));
  externals.forEach((node, index) => positions.set(node.id, { x: 1280, y: index * 120 }));
  return positions;
}

function outlineFocusedPositions(nodes: GraphNode[], edges: GraphEdge[], nodeById: Map<string, GraphNode>): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  const hierarchyNodes = nodes.filter((node) => node.kind === 'module' || node.kind === 'class').sort(compareHierarchyNodes);
  hierarchyNodes.forEach((node, index) => positions.set(node.id, { x: node.kind === 'module' ? 0 : 240, y: index * 82 }));

  const focusNodes = nodes.filter((node) => node.kind !== 'module' && node.kind !== 'class');
  const focusPositions = layeredPositions(focusNodes, edges, nodeById);
  for (const node of focusNodes) {
    const position = focusPositions.get(node.id) ?? { x: 0, y: 0 };
    positions.set(node.id, { x: position.x + 620, y: position.y });
  }
  return positions;
}

function layeredPositions(nodes: GraphNode[], edges: GraphEdge[], nodeById: Map<string, GraphNode>): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  const nodeIds = new Set(nodes.map((node) => node.id));
  const incoming = new Map<string, number>();
  const outgoing = new Map<string, string[]>();

  for (const node of nodes) {
    incoming.set(node.id, 0);
    outgoing.set(node.id, []);
  }

  for (const edge of edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue;
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge.target]);
    incoming.set(edge.target, (incoming.get(edge.target) ?? 0) + 1);
  }

  const roots = nodes.filter((node) => (incoming.get(node.id) ?? 0) === 0 && node.kind !== 'module' && node.kind !== 'class');
  const queue = (roots.length ? roots : nodes.filter((node) => node.kind !== 'module' && node.kind !== 'class')).map((node) => node.id);
  const depth = new Map<string, number>();
  for (const id of queue) depth.set(id, 0);

  while (queue.length) {
    const id = queue.shift()!;
    const nextDepth = (depth.get(id) ?? 0) + 1;
    for (const target of outgoing.get(id) ?? []) {
      if ((depth.get(target) ?? -1) >= nextDepth) continue;
      depth.set(target, nextDepth);
      queue.push(target);
    }
  }

  for (const node of nodes) {
    if (node.kind === 'module') {
      positions.set(node.id, { x: 0, y: 0 });
    } else if (node.kind === 'class') {
      positions.set(node.id, { x: 260, y: 0 });
    }
  }

  const positionedNodes = nodes.filter((node) => node.kind !== 'module' && node.kind !== 'class');
  const groups = groupBy(positionedNodes, (node) => String(depth.get(node.id) ?? fallbackDepth(node, nodeById)));
  for (const [depthKey, group] of [...groups.entries()].sort(([a], [b]) => Number(a) - Number(b))) {
    const x = 520 * Number(depthKey);
    group.sort(compareHierarchyNodes).forEach((node, index) => positions.set(node.id, { x, y: index * 130 }));
  }

  const moduleGroups = groupBy(nodes.filter((node) => node.kind === 'module' || node.kind === 'class'), (node) => String(fallbackDepth(node, nodeById)));
  for (const [depthKey, group] of [...moduleGroups.entries()].sort(([a], [b]) => Number(a) - Number(b))) {
    group.sort(compareHierarchyNodes).forEach((node, index) => {
      const existing = positions.get(node.id);
      positions.set(node.id, { x: existing?.x ?? Number(depthKey) * 260, y: index * 80 - 180 });
    });
  }

  return positions;
}

function fallbackDepth(node: GraphNode, nodeById: Map<string, GraphNode>): number {
  let depth = node.kind === 'external' ? 3 : 1;
  let current = node;
  while (current.parent_id) {
    depth += 1;
    const parent = nodeById.get(current.parent_id);
    if (!parent) break;
    current = parent;
  }
  return depth;
}

function circularPositions(nodes: GraphNode[]): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  const sorted = [...nodes].sort(compareHierarchyNodes);
  const radius = Math.max(260, sorted.length * 22);
  const center = { x: radius + 160, y: radius + 160 };
  sorted.forEach((node, index) => {
    const angle = (2 * Math.PI * index) / Math.max(sorted.length, 1) - Math.PI / 2;
    positions.set(node.id, { x: center.x + radius * Math.cos(angle), y: center.y + radius * Math.sin(angle) });
  });
  return positions;
}

function gridPositions(nodes: GraphNode[]): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  const sorted = [...nodes].sort(compareHierarchyNodes);
  const columns = Math.max(2, Math.ceil(Math.sqrt(sorted.length)));
  sorted.forEach((node, index) => {
    positions.set(node.id, { x: (index % columns) * 260, y: Math.floor(index / columns) * 130 });
  });
  return positions;
}

function hierarchyPositions(nodes: GraphNode[], nodeById: Map<string, GraphNode>): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  const modules = nodes.filter((node) => node.kind === 'module');
  const internals = nodes.filter((node) => node.kind !== 'module' && node.kind !== 'external');
  const externals = nodes.filter((node) => node.kind === 'external');
  let y = 0;

  for (const module of modules) {
    positions.set(module.id, { x: 0, y });
    y += 96;

    const moduleDescendants = internals.filter((node) => hasAncestor(node, module.id, nodeById));
    const classes = moduleDescendants.filter((node) => node.kind === 'class');
    const moduleFunctions = moduleDescendants.filter((node) => (node.kind === 'function' || node.kind === 'method') && directModuleParent(node, module.id, nodeById));

    for (const fn of moduleFunctions) {
      positions.set(fn.id, { x: 520, y });
      y += 96;
    }

    for (const cls of classes) {
      positions.set(cls.id, { x: 260, y });
      y += 88;
      const classMembers = moduleDescendants.filter((node) => (node.kind === 'function' || node.kind === 'method') && hasAncestor(node, cls.id, nodeById));
      for (const member of classMembers) {
        positions.set(member.id, { x: 520, y });
        y += 96;
      }
    }

    y += 32;
  }

  const positioned = new Set(positions.keys());
  for (const node of internals.filter((item) => !positioned.has(item.id))) {
    positions.set(node.id, { x: node.kind === 'class' ? 260 : 520, y });
    y += 96;
  }

  externals.forEach((node, index) => {
    positions.set(node.id, { x: 880, y: index * 120 });
  });

  return positions;
}

function hasAncestor(node: GraphNode, ancestorId: string, nodeById: Map<string, GraphNode>): boolean {
  let current = node;
  while (current.parent_id) {
    if (current.parent_id === ancestorId) return true;
    const parent = nodeById.get(current.parent_id);
    if (!parent) return false;
    current = parent;
  }
  return false;
}

function directModuleParent(node: GraphNode, moduleId: string, nodeById: Map<string, GraphNode>): boolean {
  if (node.parent_id === moduleId) return true;
  const parent = node.parent_id ? nodeById.get(node.parent_id) : undefined;
  return parent?.kind === 'module' && parent.id === moduleId;
}

function nodeStyle(node: GraphNode, size?: { width: number; height: number }): React.CSSProperties {
  if (node.kind === 'module' || node.kind === 'class') {
    const background = node.kind === 'module' ? 'rgba(226, 232, 240, 0.42)' : 'rgba(219, 234, 254, 0.46)';
    const border = node.kind === 'module' ? '1px solid #94a3b8' : '1px solid #93c5fd';
    return {
      background,
      border,
      borderRadius: 18,
      color: '#172033',
      fontWeight: 800,
      minWidth: 220,
      padding: 12,
      textAlign: 'left',
      width: size?.width,
      height: size?.height,
    };
  }
  const color = node.kind === 'external' ? '#fff3cd' : '#d1e7dd';
  return { background: color, border: '1px solid #9aa6bd', borderRadius: 12, color: '#172033', minWidth: 180 };
}

function edgeLabel(edge: GraphEdge, mode: EdgeLabelMode): string | undefined {
  if (mode === 'none') return undefined;
  if (mode === 'reason') return edge.evidence.reason.code.replaceAll('_', ' ');
  return edge.kind;
}

function edgeStyle(edge: GraphEdge): React.CSSProperties {
  if (edge.certainty === 'rejected') return { stroke: '#842029', strokeDasharray: '6 4' };
  if (edge.certainty === 'uncertain') return { stroke: '#b7791f', strokeDasharray: '6 4' };
  if (edge.kind === 'external_interaction') return { stroke: '#315efb' };
  return { stroke: '#0f5132' };
}

async function loadSampleGraph(): Promise<ExecutionFlowGraph> {
  const response = await fetch('/sample-graph.json');
  if (!response.ok) throw new Error(`Could not load sample graph: ${response.status}`);
  return parseGraph(await response.text());
}

function parseGuide(text: string): GuideFile {
  const parsed = JSON.parse(text) as unknown;
  if (!isGuideFile(parsed)) throw new Error('Selected file is not an AVT Guide JSON file.');
  return parsed;
}

async function parseGraph(text: string): Promise<ExecutionFlowGraph> {
  const parsed = JSON.parse(text) as unknown;
  if (!isExecutionFlowGraph(parsed)) throw new Error('Selected file is not an AVT Execution Flow Graph.');
  return parsed;
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
