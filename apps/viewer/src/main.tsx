import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ReactFlow, Background, Controls, MiniMap, type Edge as FlowEdge, type Node as FlowNode } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import './styles.css';
import type { EntryPoint, ExecutionFlow, ExecutionFlowGraph, FlowMarker, GraphEdge, GraphNode } from './graph';
import { isExecutionFlowGraph } from './graph';

type InspectorSelection =
  | { type: 'node'; item: GraphNode; markers: FlowMarker[] }
  | { type: 'edge'; item: GraphEdge }
  | null;

interface EdgeFilters {
  showConfirmed: boolean;
  showUncertain: boolean;
  showRejected: boolean;
}

function App() {
  const [graph, setGraph] = useState<ExecutionFlowGraph | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedEntryPointId, setSelectedEntryPointId] = useState<string>('');
  const [selection, setSelection] = useState<InspectorSelection>(null);
  const [edgeFilters, setEdgeFilters] = useState<EdgeFilters>({ showConfirmed: true, showUncertain: true, showRejected: false });

  useEffect(() => {
    loadSampleGraph()
      .then((sample) => {
        setGraph(sample);
        setSelectedEntryPointId(sample.entry_points[0]?.id ?? '');
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)));
  }, []);

  const selectedFlow = useMemo(() => {
    if (!graph) return null;
    return graph.flows.find((flow) => flow.entry_point_id === selectedEntryPointId) ?? graph.flows[0] ?? null;
  }, [graph, selectedEntryPointId]);

  const selectedEntryPoint = useMemo(() => {
    if (!graph || !selectedFlow) return null;
    return graph.entry_points.find((entry) => entry.id === selectedFlow.entry_point_id) ?? null;
  }, [graph, selectedFlow]);

  const flowModel = useMemo(() => {
    if (!graph || !selectedFlow) return emptyFlowModel();
    return buildFlowModel(graph, selectedFlow, edgeFilters);
  }, [graph, selectedFlow, edgeFilters]);

  async function handleFileSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setError(null);
    setSelection(null);
    try {
      const nextGraph = await parseGraph(await file.text());
      setGraph(nextGraph);
      setSelectedEntryPointId(nextGraph.entry_points[0]?.id ?? '');
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
        <label className="filePicker">
          Load graph JSON
          <input type="file" accept="application/json,.json" onChange={handleFileSelected} />
        </label>
      </header>

      {error ? <section className="error">{error}</section> : null}
      {graph ? (
        <section className="layout">
          <aside className="panel sidebar">
            <GraphSummary graph={graph} />

            <label className="selectLabel" htmlFor="entryPoint">Selected Entry Point</label>
            <select
              id="entryPoint"
              value={selectedEntryPointId}
              onChange={(event) => {
                setSelectedEntryPointId(event.target.value);
                setSelection(null);
              }}
            >
              {graph.entry_points.map((entry) => (
                <option key={entry.id} value={entry.id}>{entry.label}</option>
              ))}
            </select>

            {selectedEntryPoint ? <EntryPointSummary entryPoint={selectedEntryPoint} /> : null}
            <EdgeFilterControls filters={edgeFilters} onChange={setEdgeFilters} />
            <Inspector selection={selection} />
          </aside>

          <section className="panel flowPanel">
            {selectedFlow ? (
              <>
                <FlowHeader flow={selectedFlow} nodeCount={flowModel.flowNodes.length} edgeCount={flowModel.flowEdges.length} />
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

function EntryPointSummary({ entryPoint }: { entryPoint: EntryPoint }) {
  return (
    <section className="summaryBlock">
      <h3>Entry Point</h3>
      <p><strong>{entryPoint.kind}</strong></p>
      <p>{entryPoint.evidence.location.path}:{entryPoint.evidence.location.line}</p>
      <p>{entryPoint.evidence.reason.label}</p>
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

function FlowHeader({ flow, nodeCount, edgeCount }: { flow: ExecutionFlow; nodeCount: number; edgeCount: number }) {
  return (
    <div className="flowHeader">
      <div>
        <p className="eyebrow">Selected Execution Flow</p>
        <h2>{flow.id}</h2>
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

function buildFlowModel(graph: ExecutionFlowGraph, flow: ExecutionFlow, filters: EdgeFilters) {
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const edgeById = new Map(graph.edges.map((edge) => [edge.id, edge]));
  const markerById = new Map(graph.markers.map((marker) => [marker.id, marker]));

  const visibleEdgeIds = new Set(
    flow.edge_ids.filter((edgeId) => {
      const edge = edgeById.get(edgeId);
      if (!edge) return false;
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

  for (const nodeId of [...flowNodeIds]) {
    let current = nodeById.get(nodeId);
    while (current?.parent_id) {
      flowNodeIds.add(current.parent_id);
      current = nodeById.get(current.parent_id);
    }
  }

  const flowNodes = [...flowNodeIds].map((id) => nodeById.get(id)).filter((node): node is GraphNode => Boolean(node)).sort((a, b) => a.id.localeCompare(b.id));
  const flowEdges = [...visibleEdgeIds].map((id) => edgeById.get(id)).filter((edge): edge is GraphEdge => Boolean(edge)).sort((a, b) => a.id.localeCompare(b.id));
  const flowMarkers = flow.marker_ids.map((id) => markerById.get(id)).filter((marker): marker is FlowMarker => Boolean(marker));

  const markersByNodeId = new Map<string, FlowMarker[]>();
  for (const marker of flowMarkers) {
    if (!marker.node_id) continue;
    markersByNodeId.set(marker.node_id, [...(markersByNodeId.get(marker.node_id) ?? []), marker]);
  }

  const reactFlowNodes = flowNodes.map((node, index): FlowNode => ({
    id: node.id,
    position: layoutPosition(index, node.kind),
    data: {
      label: `${node.kind}: ${node.label}${markersByNodeId.has(node.id) ? ` • ${markersByNodeId.get(node.id)?.length} marker(s)` : ''}`,
    },
    type: 'default',
    style: nodeStyle(node),
  }));

  const reactFlowEdges = flowEdges.map((edge): FlowEdge => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    label: edge.kind,
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

function layoutPosition(index: number, kind: GraphNode['kind']) {
  const column = kind === 'module' || kind === 'class' ? 0 : kind === 'external' ? 2 : 1;
  const row = Math.floor(index / 3);
  return { x: column * 320, y: row * 140 + (index % 3) * 24 };
}

function nodeStyle(node: GraphNode): React.CSSProperties {
  const color = node.kind === 'external' ? '#fff3cd' : node.kind === 'module' || node.kind === 'class' ? '#e2e3e5' : '#d1e7dd';
  return { background: color, border: '1px solid #9aa6bd', borderRadius: 12, color: '#172033', minWidth: 180 };
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
