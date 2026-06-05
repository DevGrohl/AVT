import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ReactFlow, Background, Controls, MiniMap, type Edge as FlowEdge, type Node as FlowNode } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import './styles.css';
import type { EntryPoint, ExecutionFlow, ExecutionFlowGraph, FlowMarker, GraphEdge, GraphNode, GuideFile } from './graph';
import { isExecutionFlowGraph, isGuideFile } from './graph';

type InspectorSelection =
  | { type: 'node'; item: GraphNode; markers: FlowMarker[] }
  | { type: 'edge'; item: GraphEdge }
  | null;

type DiagramLayout = 'hierarchy' | 'layered' | 'circular' | 'grid';

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

function App() {
  const [graph, setGraph] = useState<ExecutionFlowGraph | null>(null);
  const [guide, setGuide] = useState<GuideFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedSelectionId, setSelectedSelectionId] = useState<string>('');
  const [selection, setSelection] = useState<InspectorSelection>(null);
  const [edgeFilters, setEdgeFilters] = useState<EdgeFilters>({ showConfirmed: true, showUncertain: true, showRejected: false });
  const [diagramLayout, setDiagramLayout] = useState<DiagramLayout>('layered');
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
            <GuideSummary guide={guide} />
            <Inspector selection={selection} />
          </aside>

          <section className="panel flowPanel">
            {selectedFlow ? (
              <>
                <FlowHeader flow={selectedFlow} label={selectedOption?.label ?? selectedFlow.id} nodeCount={flowModel.flowNodes.length} edgeCount={flowModel.flowEdges.length} />
                <div className="graphCanvas" aria-label="Selected Execution Flow graph">
                  <ReactFlow
                    nodes={flowModel.reactFlowNodes}
                    edges={flowModel.reactFlowEdges}
                    fitView
                    onNodeClick={(_: React.MouseEvent, node: FlowNode) => {
                      const graphNode = flowModel.nodeById.get(String(node.id));
                      if (graphNode) setSelection({ type: 'node', item: graphNode, markers: flowModel.markersByNodeId.get(graphNode.id) ?? [] });
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
        <option value="layered">Layered flow</option>
        <option value="hierarchy">Hierarchy by module/class</option>
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

function GuideSummary({ guide }: { guide: GuideFile | null }) {
  if (!guide) {
    return (
      <section className="summaryBlock">
        <h3>Guide</h3>
        <p className="hint">Load a Phase 2 guide JSON file to inspect suggested Entry Points and reasons.</p>
      </section>
    );
  }

  return (
    <section className="summaryBlock guidePanel">
      <h3>Guide suggestions</h3>
      {guide.project_observations.length ? (
        <ul className="compactList">
          {guide.project_observations.map((observation, index) => <li key={index}>{observation}</li>)}
        </ul>
      ) : null}
      <ul className="guideList">
        {guide.suggested_entry_points.map((suggestion) => (
          <li key={`${suggestion.entry}:${suggestion.kind}`}>
            <span className={`certainty certainty-${suggestion.confidence === 'high' ? 'confirmed' : suggestion.confidence === 'medium' ? 'uncertain' : 'rejected'}`}>{suggestion.confidence}</span>
            <strong>{suggestion.entry}</strong>
            <p>{suggestion.reason}</p>
            <p className="hint">Risk: {suggestion.risk}</p>
          </li>
        ))}
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

function FlowHeader({ flow, label, nodeCount, edgeCount }: { flow: ExecutionFlow; label: string; nodeCount: number; edgeCount: number }) {
  return (
    <div className="flowHeader">
      <div>
        <p className="eyebrow">Selected Execution Flow</p>
        <h2>{label}</h2>
      </div>
      <div className="counts">
        <span>{nodeCount} visible nodes</span>
        <span>{edgeCount} visible edges</span>
        <span>{flow.marker_ids.length} markers</span>
      </div>
    </div>
  );
}

function FlowLists({ nodes, edges, markersByNodeId }: { nodes: GraphNode[]; edges: GraphEdge[]; markersByNodeId: Map<string, FlowMarker[]> }) {
  return (
    <div className="columns lowerLists">
      <section>
        <h3>Visible nodes</h3>
        <ul className="itemList">
          {nodes.map((node) => (
            <li key={node.id}>
              <span className={`kind kind-${node.kind}`}>{node.kind}</span>
              <strong>{node.label}</strong>
              {node.signature ? <code>{node.signature}</code> : null}
              {(markersByNodeId.get(node.id) ?? []).length > 0 ? <p>{markersByNodeId.get(node.id)?.length} Flow Marker(s)</p> : null}
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h3>Visible edges</h3>
        <ul className="itemList">
          {edges.map((edge) => (
            <li key={edge.id}>
              <span className={`certainty certainty-${edge.certainty}`}>{edge.certainty}</span>
              <strong>{edge.kind}</strong>
              <p>{edge.evidence.reason.label}</p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function Inspector({ selection }: { selection: InspectorSelection }) {
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

function defaultSelectionId(graph: ExecutionFlowGraph): string {
  const options = buildSelectionOptions(graph);
  return options[0]?.id ?? '';
}

function buildSelectionOptions(graph: ExecutionFlowGraph): FlowSelectionOption[] {
  const entryOptions: FlowSelectionOption[] = graph.entry_points.map((entry) => ({
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
  if (layout === 'hierarchy') {
    const positions = hierarchyPositions(nodes, nodeById);
    return showHierarchyContext ? areaLayout(nodes, nodeById, positions) : emptyLayoutModel(positions);
  }
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
  const positions = new Map(absolute);

  for (const node of nodes) {
    if (!node.parent_id || !visibleIds.has(node.parent_id)) continue;
    const parent = nodeById.get(node.parent_id);
    if (parent?.kind === 'module' || parent?.kind === 'class') parentIds.set(node.id, parent.id);
  }

  for (const node of nodes) {
    const parentId = parentIds.get(node.id);
    if (!parentId) continue;
    const parentPosition = absolute.get(parentId) ?? { x: 0, y: 0 };
    const nodePosition = absolute.get(node.id) ?? { x: 0, y: 0 };
    positions.set(node.id, {
      x: Math.max(24, nodePosition.x - parentPosition.x + 32),
      y: Math.max(52, nodePosition.y - parentPosition.y + 56),
    });
  }

  const containers = nodes.filter((node) => node.kind === 'class' || node.kind === 'module').sort((a, b) => containerDepth(b, nodeById) - containerDepth(a, nodeById));
  for (const container of containers) {
    const children = nodes.filter((node) => parentIds.get(node.id) === container.id);
    const minimum = container.kind === 'module' ? { width: 820, height: 180 } : { width: 560, height: 150 };
    let width = minimum.width;
    let height = minimum.height;
    for (const child of children) {
      const position = positions.get(child.id) ?? { x: 0, y: 0 };
      const childSize = sizes.get(child.id) ?? defaultNodeSize(child);
      width = Math.max(width, position.x + childSize.width + 40);
      height = Math.max(height, position.y + childSize.height + 40);
    }
    sizes.set(container.id, { width, height });
  }

  return { positions, parentIds, sizes };
}

function defaultNodeSize(node: GraphNode): { width: number; height: number } {
  if (node.kind === 'module') return { width: 820, height: 180 };
  if (node.kind === 'class') return { width: 560, height: 150 };
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
