import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ReactFlow, Background, Controls, MiniMap, type Edge as FlowEdge, type Node as FlowNode, type XYPosition } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import './styles.css';
import type { EntryPoint, ExecutionFlow, ExecutionFlowGraph, FlowMarker, GraphEdge, GraphNode, GuideFile } from './graph';
import { isExecutionFlowGraph, isGuideFile } from './graph';

interface OutcomeInfo {
  id: string;
  type: 'error' | 'success';
  sourceNodeId: string;
  marker: FlowMarker;
  trigger: string;
}

type InspectorSelection =
  | { type: 'node'; item: GraphNode; markers: FlowMarker[] }
  | { type: 'edge'; item: GraphEdge }
  | { type: 'outcome'; item: OutcomeInfo }
  | null;

type DiagramLayout = 'hierarchy-nested' | 'hierarchy-swimlane' | 'hierarchy-outline' | 'code-flow' | 'layered' | 'circular' | 'grid';

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
type EdgeResolutions = Record<string, 'confirmed' | 'rejected'>;

interface AnalysisOverlayFile {
  edge_resolutions: Array<{ edge_id: string; certainty: 'confirmed' | 'rejected' }>;
}

interface LayoutOverlayFile {
  kind: 'avt-layout-overlay';
  version: 1;
  project_name?: string;
  positions: PositionOverrides;
}

function App() {
  const [graph, setGraph] = useState<ExecutionFlowGraph | null>(null);
  const [guide, setGuide] = useState<GuideFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedSelectionId, setSelectedSelectionId] = useState<string>('');
  const [entrySearch, setEntrySearch] = useState<string>('');
  const [selection, setSelection] = useState<InspectorSelection>(null);
  const [positionOverrides, setPositionOverrides] = useState<PositionOverrides>({});
  const [edgeResolutions, setEdgeResolutions] = useState<EdgeResolutions>({});
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

  const visibleSelectionOptions = useMemo(() => {
    const query = entrySearch.trim().toLowerCase();
    if (!query) return selectionOptions;
    const tokens = query.split(/\s+/).filter(Boolean);
    const filtered = selectionOptions.filter((option) => {
      const haystack = `${option.label} ${option.id}`.toLowerCase();
      return tokens.every((token) => haystack.includes(token));
    });
    const selected = selectionOptions.find((option) => option.id === selectedSelectionId);
    if (selected && !filtered.some((option) => option.id === selected.id)) return [selected, ...filtered];
    return filtered;
  }, [selectionOptions, selectedSelectionId, entrySearch]);

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

  const selectedImportance = useMemo(() => {
    if (!graph || !selectedEntryPoint) return null;
    return entryImportance(graph, selectedEntryPoint);
  }, [graph, selectedEntryPoint]);

  const flowModel = useMemo(() => {
    if (!graph || !selectedFlow) return emptyFlowModel();
    return buildFlowModel(graph, selectedFlow, edgeFilters, diagramLayout, displayOptions, edgeResolutions);
  }, [graph, selectedFlow, edgeFilters, diagramLayout, displayOptions, edgeResolutions]);

  const editKey = selectedFlow ? layoutEditKey(selectedFlow.id, diagramLayout, displayOptions) : '';
  const currentOverrides = editKey ? positionOverrides[editKey] ?? {} : {};
  const editedNodeCount = Object.keys(currentOverrides).length;
  const displayedReactFlowNodes = useMemo(
    () => flowModel.reactFlowNodes.map((node) => currentOverrides[node.id] ? { ...node, position: currentOverrides[node.id] } : node),
    [flowModel.reactFlowNodes, currentOverrides],
  );

  async function handleLayoutSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setError(null);
    setNotice(null);
    try {
      const overlay = parseLayoutOverlay(await file.text());
      setPositionOverrides(overlay.positions);
      const count = Object.keys(overlay.positions).length;
      if (graph && overlay.project_name && overlay.project_name !== graph.metadata.project_name) {
        setNotice(`Loaded layout overlay with ${count} edited view(s), but project name differs: ${overlay.project_name} vs ${graph.metadata.project_name}.`);
      } else {
        setNotice(`Loaded layout overlay with ${count} edited view(s).`);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  function handleExportAnalysisOverlay() {
    const overlay: AnalysisOverlayFile = {
      edge_resolutions: Object.entries(edgeResolutions).map(([edge_id, certainty]) => ({ edge_id, certainty })),
    };
    const blob = new Blob([`${JSON.stringify(overlay, null, 2)}\n`], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${graph?.metadata.project_name || 'avt'}-analysis-overlay.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setNotice('Analysis overlay exported.');
  }

  function handleExportLayout() {
    if (!graph) return;
    const overlay: LayoutOverlayFile = {
      kind: 'avt-layout-overlay',
      version: 1,
      project_name: graph.metadata.project_name,
      positions: positionOverrides,
    };
    const blob = new Blob([`${JSON.stringify(overlay, null, 2)}\n`], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${graph.metadata.project_name || 'avt'}-layout-overlay.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setNotice('Layout overlay exported.');
  }

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
      setEdgeResolutions({});
      setNotice(null);
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
          <label className="filePicker secondaryPicker">
            Load layout JSON
            <input type="file" accept="application/json,.json" onChange={handleLayoutSelected} />
          </label>
        </div>
      </header>

      {error ? <section className="error">{error}</section> : null}
      {notice ? <section className="notice">{notice}</section> : null}
      {graph ? (
        <section className="layout">
          <aside className="panel sidebar">
            <GraphSummary graph={graph} />
            <RepositoryHotspots graph={graph} />

            <details className="sidebarSection" open>
              <summary>Entry Point / Group</summary>
              <SearchableSelectionDropdown
                options={visibleSelectionOptions}
                totalCount={selectionOptions.length}
                selectedOption={selectedOption}
                query={entrySearch}
                onQueryChange={setEntrySearch}
                onSelect={(option) => {
                  setSelectedSelectionId(option.id);
                  setSelection(null);
                  setEntrySearch('');
                }}
              />
              {selectedOption?.kind === 'group' ? <GroupSummary option={selectedOption} /> : null}
              {selectedEntryPoint ? <EntryPointSummary entryPoint={selectedEntryPoint} /> : null}
            </details>

            <details className="sidebarSection">
              <summary>Diagram options</summary>
              <DiagramLayoutControls layout={diagramLayout} onChange={setDiagramLayout} />
              <DiagramDisplayControls options={displayOptions} onChange={setDisplayOptions} />
              <EdgeFilterControls filters={edgeFilters} onChange={setEdgeFilters} />
            </details>

            <details className="sidebarSection">
              <summary>Overlays</summary>
              <LayoutOverlayControls editedViewCount={Object.keys(positionOverrides).length} onExport={handleExportLayout} />
              <AnalysisOverlayControls resolutionCount={Object.keys(edgeResolutions).length} onExport={handleExportAnalysisOverlay} />
            </details>
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
              graph={graph}
              onResolveEdge={(edge, certainty) => {
                setEdgeResolutions((previous) => ({ ...previous, [edge.id]: certainty }));
                setNotice(`Marked selected edge as ${certainty} in the in-memory Analysis Overlay.`);
              }}
              onClearEdgeResolution={(edge) => {
                setEdgeResolutions((previous) => {
                  const next = { ...previous };
                  delete next[edge.id];
                  return next;
                });
                setNotice('Cleared selected edge overlay resolution.');
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
                  importance={selectedImportance}
                  onResetLayout={() => {
                    if (!editKey) return;
                    setPositionOverrides((previous) => {
                      const next = { ...previous };
                      delete next[editKey];
                      return next;
                    });
                  }}
                />
                <DeveloperOnboardingPanel
                  projectName={graph.metadata.project_name}
                  flowLabel={selectedOption?.label ?? selectedFlow.id}
                  entryPoint={selectedEntryPoint}
                  nodes={flowModel.flowNodes}
                  edges={flowModel.flowEdges}
                />
                <div className="graphCanvas" aria-label="Selected Execution Flow graph">
                  <ReactFlow
                    key={`${selectedFlow.id}:${diagramLayout}:${displayOptions.showHierarchyContext}:${displayOptions.showExternalInteractions}:${displayOptions.edgeLabelMode}`}
                    nodes={displayedReactFlowNodes}
                    edges={flowModel.reactFlowEdges}
                    fitView
                    fitViewOptions={{ padding: 0.18 }}
                    onNodeClick={(_: React.MouseEvent, node: FlowNode) => {
                      const outcome = flowModel.outcomeById.get(String(node.id));
                      if (outcome) {
                        setSelection({ type: 'outcome', item: outcome });
                        return;
                      }
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

function SearchableSelectionDropdown({
  options,
  totalCount,
  selectedOption,
  query,
  onQueryChange,
  onSelect,
}: {
  options: FlowSelectionOption[];
  totalCount: number;
  selectedOption: FlowSelectionOption | null;
  query: string;
  onQueryChange: (query: string) => void;
  onSelect: (option: FlowSelectionOption) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <div className="comboBox">
      <button
        className="comboButton"
        type="button"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((open) => !open)}
      >
        <span>{selectedOption?.label ?? 'Select Entry Point / Group'}</span>
        <span aria-hidden="true">▾</span>
      </button>
      {isOpen ? (
        <div className="comboPanel">
          <label className="selectLabel" htmlFor="entryPointSearch">Search Entry Points / Groups</label>
          <input
            id="entryPointSearch"
            className="searchInput"
            type="search"
            value={query}
            placeholder="Search route, file, kind, score…"
            autoFocus
            onChange={(event) => onQueryChange(event.target.value)}
          />
          <div className="comboList" role="listbox" aria-label="Entry Point / Group options">
            {options.length ? options.map((option) => (
              <button
                key={option.id}
                className={`comboOption${selectedOption?.id === option.id ? ' selectedComboOption' : ''}`}
                type="button"
                role="option"
                aria-selected={selectedOption?.id === option.id}
                onClick={() => {
                  onSelect(option);
                  setIsOpen(false);
                }}
              >
                {option.label}
              </button>
            )) : <p className="hint">No matching Entry Points.</p>}
          </div>
          <p className="hint">Showing {options.length} of {totalCount} option(s).</p>
        </div>
      ) : null}
    </div>
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

function RepositoryHotspots({ graph }: { graph: ExecutionFlowGraph }) {
  const hotspots = useMemo(() => buildRepositoryHotspots(graph), [graph]);
  return (
    <section className="summaryBlock">
      <h3>Repo hotspots</h3>
      <details className="compactDetails">
        <summary>Open onboarding overview</summary>
        <div className="hotspotList">
          <HotspotBlock title="Most touched files" items={hotspots.files} />
          <HotspotBlock title="DB/write-heavy flows" items={hotspots.dbFlows} />
          <HotspotBlock title="Auth/security flows" items={hotspots.securityFlows} />
          <HotspotBlock title="Uncertainty to review" items={hotspots.uncertain} />
        </div>
      </details>
    </section>
  );
}

function HotspotBlock({ title, items }: { title: string; items: string[] }) {
  return (
    <section>
      <h4>{title}</h4>
      {items.length ? <ol>{items.map((item) => <li key={item}>{item}</li>)}</ol> : <p className="hint">None detected.</p>}
    </section>
  );
}

function buildRepositoryHotspots(graph: ExecutionFlowGraph): { files: string[]; dbFlows: string[]; securityFlows: string[]; uncertain: string[] } {
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const edgeById = new Map(graph.edges.map((edge) => [edge.id, edge]));
  const entryById = new Map(graph.entry_points.map((entry) => [entry.id, entry]));
  const fileCounts = new Map<string, number>();
  for (const node of graph.nodes) if (node.path) fileCounts.set(node.path, (fileCounts.get(node.path) ?? 0) + 1);
  for (const edge of graph.edges) fileCounts.set(edge.evidence.location.path, (fileCounts.get(edge.evidence.location.path) ?? 0) + 1);

  const flowFacts = graph.flows.map((flow) => {
    const entry = entryById.get(flow.entry_point_id);
    const edges = flow.edge_ids.map((id) => edgeById.get(id)).filter((edge): edge is GraphEdge => Boolean(edge));
    const labels = flow.node_ids.map((id) => nodeById.get(id)?.label ?? '').join(' ').toLowerCase();
    const entryLabel = entry?.label ?? flow.id;
    return {
      label: entryLabel,
      dbScore: edges.filter((edge) => edge.kind === 'external_interaction' && (nodeById.get(edge.target)?.label ?? '').includes('database:')).length,
      securityScore: /auth|token|login|security|session|current_user|user/.test(`${entryLabel} ${labels}`.toLowerCase()) ? 1 : 0,
      uncertainScore: edges.filter((edge) => edge.certainty === 'uncertain').length,
    };
  });

  return {
    files: [...fileCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 5).map(([path, count]) => `${path} (${count})`),
    dbFlows: flowFacts.filter((flow) => flow.dbScore > 0).sort((a, b) => b.dbScore - a.dbScore || a.label.localeCompare(b.label)).slice(0, 5).map((flow) => `${flow.label} (${flow.dbScore})`),
    securityFlows: flowFacts.filter((flow) => flow.securityScore > 0).slice(0, 5).map((flow) => flow.label),
    uncertain: flowFacts.filter((flow) => flow.uncertainScore > 0).sort((a, b) => b.uncertainScore - a.uncertainScore || a.label.localeCompare(b.label)).slice(0, 5).map((flow) => `${flow.label} (${flow.uncertainScore})`),
  };
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
        <optgroup label="V1 stable">
          <option value="hierarchy-swimlane">Swimlane hierarchy</option>
        </optgroup>
        <optgroup label="Experimental alternatives">
          <option value="hierarchy-outline">Outline + focused graph</option>
          <option value="hierarchy-nested">Nested ownership map</option>
          <option value="code-flow">Code flow paths</option>
          <option value="layered">Layered flow</option>
          <option value="circular">Circular relationships</option>
          <option value="grid">Compact grid</option>
        </optgroup>
      </select>
      <p className="hint">V1 defaults to swimlane hierarchy. Other layouts are exploratory and should not block the standard onboarding path.</p>
    </section>
  );
}

function LayoutOverlayControls({ editedViewCount, onExport }: { editedViewCount: number; onExport: () => void }) {
  return (
    <section className="summaryBlock">
      <h3>Layout overlay</h3>
      <p className="hint">Save/load manual node positions separately from graph facts.</p>
      <button className="linkButton" type="button" onClick={onExport} disabled={!editedViewCount}>Export layout JSON</button>
      <p className="hint">{editedViewCount} edited view(s) in memory.</p>
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
  const [confidenceFilter, setConfidenceFilter] = useState<'all' | 'high' | 'medium' | 'low'>('all');
  const [kindFilter, setKindFilter] = useState<string>('all');
  if (!guide) {
    return (
      <section className="summaryBlock">
        <h3>Guide</h3>
        <p className="hint">Load a Phase 2 guide JSON file to inspect suggested Entry Points and reasons.</p>
      </section>
    );
  }

  const entryByRef = buildEntryRefIndex(graph);
  const kinds = [...new Set(guide.suggested_entry_points.map((suggestion) => suggestion.kind))].sort();
  const filteredSuggestions = guide.suggested_entry_points.filter((suggestion) => {
    if (confidenceFilter !== 'all' && suggestion.confidence !== confidenceFilter) return false;
    if (kindFilter !== 'all' && suggestion.kind !== kindFilter) return false;
    return true;
  });
  return (
    <section className="summaryBlock guidePanel">
      <h3>Guide suggestions</h3>
      {guide.project_observations.length ? (
        <ul className="compactList">
          {guide.project_observations.map((observation, index) => <li key={index}>{observation}</li>)}
        </ul>
      ) : null}
      <div className="guideFilters">
        <label>
          Confidence
          <select value={confidenceFilter} onChange={(event) => setConfidenceFilter(event.target.value as 'all' | 'high' | 'medium' | 'low')}>
            <option value="all">All</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </label>
        <label>
          Kind
          <select value={kindFilter} onChange={(event) => setKindFilter(event.target.value)}>
            <option value="all">All</option>
            {kinds.map((kind) => <option key={kind} value={kind}>{kind}</option>)}
          </select>
        </label>
      </div>
      <p className="hint">Showing {filteredSuggestions.length} of {guide.suggested_entry_points.length} suggestion(s).</p>
      <ul className="guideList">
        {filteredSuggestions.map((suggestion) => {
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

function AnalysisOverlayControls({ resolutionCount, onExport }: { resolutionCount: number; onExport: () => void }) {
  return (
    <section className="summaryBlock">
      <h3>Analysis Overlay</h3>
      <p className="hint">Confirm/reject uncertain edges from the edge inspector, then export `.avt/overlay.json`.</p>
      <button className="linkButton" type="button" onClick={onExport} disabled={!resolutionCount}>Export overlay JSON</button>
      <p className="hint">{resolutionCount} edge resolution(s) in memory.</p>
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
  importance,
  onResetLayout,
}: {
  flow: ExecutionFlow;
  label: string;
  nodeCount: number;
  edgeCount: number;
  layout: DiagramLayout;
  editedNodeCount: number;
  importance: EntryImportance | null;
  onResetLayout: () => void;
}) {
  return (
    <div className="flowHeader">
      <div>
        <p className="eyebrow">Selected Execution Flow</p>
        <h2>{label}</h2>
        <p className="hint">{layoutDescription(layout)}</p>
        {importance ? <p className="rankReason">Rank score {importance.score}: {importance.reasons.join('; ')}</p> : null}
      </div>
      <div className="counts">
        <span>{nodeCount} visible nodes</span>
        <span>{edgeCount} visible edges</span>
        <span>{flow.marker_ids.length} markers</span>
        {editedNodeCount ? <span>{editedNodeCount} moved</span> : null}
        <button className="linkButton" type="button" onClick={onResetLayout} disabled={!editedNodeCount}>Reset layout</button>
      </div>
    </div>
  );
}

interface FlowOnboardingInfo {
  summary: string;
  files: Array<{ path: string; reason: string; score: number }>;
  breadcrumbs: GraphNode[];
  externalInteractions: string[];
}

function DeveloperOnboardingPanel({
  projectName,
  flowLabel,
  entryPoint,
  nodes,
  edges,
}: {
  projectName: string;
  flowLabel: string;
  entryPoint: EntryPoint | null;
  nodes: GraphNode[];
  edges: GraphEdge[];
}) {
  const info = useMemo(() => buildFlowOnboardingInfo(entryPoint, nodes, edges), [entryPoint, nodes, edges]);
  return (
    <section className="onboardingPanel">
      <div className="onboardingHeader">
        <div>
          <h3>Developer onboarding</h3>
          <p>{info.summary}</p>
        </div>
        <button className="linkButton" type="button" onClick={() => exportFlowOnboardingReport(projectName, flowLabel, info)}>Export Markdown</button>
      </div>
      <div className="onboardingGrid">
        <section>
          <h4>Execution breadcrumb</h4>
          {info.breadcrumbs.length ? (
            <ol className="breadcrumbList">
              {info.breadcrumbs.map((node) => (
                <li key={node.id}><span className={`kind kind-${node.kind}`}>{node.kind}</span>{node.label}</li>
              ))}
            </ol>
          ) : <p className="hint">No readable behavior path found for this flow.</p>}
        </section>
        <section>
          <h4>Files to read next</h4>
          {info.files.length ? (
            <ol className="fileReadList">
              {info.files.slice(0, 6).map((file) => (
                <li key={file.path}><code>{file.path}</code><p>{file.reason}</p></li>
              ))}
            </ol>
          ) : <p className="hint">No source files found in this flow.</p>}
        </section>
        <section>
          <h4>External/DB interactions</h4>
          {info.externalInteractions.length ? (
            <ul className="compactBullets">
              {info.externalInteractions.slice(0, 8).map((label) => <li key={label}>{label}</li>)}
            </ul>
          ) : <p className="hint">No external interactions visible in this flow.</p>}
        </section>
      </div>
    </section>
  );
}

function exportFlowOnboardingReport(projectName: string, flowLabel: string, info: FlowOnboardingInfo) {
  const lines = [
    `# ${projectName} flow onboarding`,
    '',
    `## ${flowLabel}`,
    '',
    info.summary,
    '',
    '## Execution breadcrumb',
    '',
    ...(info.breadcrumbs.length ? info.breadcrumbs.map((node, index) => `${index + 1}. **${node.kind}** ${node.label}${node.path ? ` (${node.path})` : ''}`) : ['No readable behavior path found.']),
    '',
    '## Files to read next',
    '',
    ...(info.files.length ? info.files.map((file, index) => `${index + 1}. \`${file.path}\` — ${file.reason}`) : ['No source files found.']),
    '',
    '## External/DB interactions',
    '',
    ...(info.externalInteractions.length ? info.externalInteractions.map((label) => `- ${label}`) : ['No external interactions visible.']),
    '',
  ];
  downloadText(`${projectName || 'avt'}-flow-onboarding.md`, lines.join('\n'), 'text/markdown');
}

function downloadText(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function buildFlowOnboardingInfo(entryPoint: EntryPoint | null, nodes: GraphNode[], edges: GraphEdge[]): FlowOnboardingInfo {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const behaviorNodes = nodes.filter((node) => node.kind !== 'module' && node.kind !== 'class');
  const externalInteractions = sortedUnique(behaviorNodes.filter((node) => node.kind === 'external').map((node) => node.label));
  const files = rankFlowFiles(entryPoint, behaviorNodes, edges);
  const breadcrumbs = buildBreadcrumb(entryPoint, behaviorNodes, edges, nodeById);
  const methods = entryPoint?.http_methods?.join(', ');
  const route = entryPoint?.route_path;
  const entryLabel = route ? `${methods || 'ROUTE'} ${route}` : entryPoint?.label ?? 'Selected flow';
  const sourceCount = files.length;
  const externalText = externalInteractions.length ? `touches ${externalInteractions.length} external/DB interaction(s)` : 'has no visible external interactions';
  const summary = `${entryLabel} spans ${sourceCount} source file(s), shows ${edges.length} visible edge(s), and ${externalText}. Start with the files and breadcrumb below before using the diagram for detail.`;
  return { summary, files, breadcrumbs, externalInteractions };
}

function rankFlowFiles(entryPoint: EntryPoint | null, nodes: GraphNode[], edges: GraphEdge[]): Array<{ path: string; reason: string; score: number }> {
  const byPath = new Map<string, { path: string; score: number; reasons: Set<string> }>();
  const ensure = (path: string) => {
    const existing = byPath.get(path);
    if (existing) return existing;
    const next = { path, score: 0, reasons: new Set<string>() };
    byPath.set(path, next);
    return next;
  };
  for (const node of nodes) {
    if (!node.path) continue;
    const item = ensure(node.path);
    item.score += node.kind === 'function' || node.kind === 'method' ? 3 : 1;
    if (node.id === entryPoint?.node_id) {
      item.score += 20;
      item.reasons.add('Entry Point handler');
    } else if (node.kind === 'function' || node.kind === 'method') {
      item.reasons.add('flow behavior');
    }
  }
  for (const edge of edges) {
    const path = edge.evidence.location.path;
    const item = ensure(path);
    item.score += edge.kind === 'external_interaction' ? 4 : 1;
    if (edge.kind === 'external_interaction') item.reasons.add('external/DB interaction evidence');
    if (edge.certainty === 'uncertain') item.reasons.add('uncertainty to review');
  }
  return [...byPath.values()]
    .map((item) => ({ path: item.path, score: item.score, reason: [...item.reasons].slice(0, 3).join(', ') || 'referenced by flow evidence' }))
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
}

function buildBreadcrumb(entryPoint: EntryPoint | null, nodes: GraphNode[], edges: GraphEdge[], nodeById: Map<string, GraphNode>): GraphNode[] {
  const startId = entryPoint?.node_id ?? nodes.find((node) => node.kind !== 'external')?.id;
  if (!startId) return [];
  const outgoing = new Map<string, GraphEdge[]>();
  for (const edge of edges) outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge]);
  const path: GraphNode[] = [];
  const seen = new Set<string>();
  let currentId: string | undefined = startId;
  while (currentId && !seen.has(currentId) && path.length < 8) {
    seen.add(currentId);
    const node = nodeById.get(currentId);
    if (node && node.kind !== 'module' && node.kind !== 'class') path.push(node);
    const nextEdge: GraphEdge | undefined = (outgoing.get(currentId) ?? [])
      .filter((edge) => !seen.has(edge.target))
      .sort((a, b) => breadcrumbEdgeScore(b, nodeById) - breadcrumbEdgeScore(a, nodeById) || a.id.localeCompare(b.id))[0];
    currentId = nextEdge?.target;
  }
  return path;
}

function breadcrumbEdgeScore(edge: GraphEdge, nodeById: Map<string, GraphNode>): number {
  const target = nodeById.get(edge.target);
  let score = edge.kind === 'external_interaction' ? 2 : 5;
  if (target?.kind === 'external') score += 1;
  if (target?.kind === 'function' || target?.kind === 'method') score += 4;
  if (edge.certainty === 'confirmed') score += 2;
  return score;
}

function layoutDescription(layout: DiagramLayout): string {
  if (layout === 'hierarchy-nested') return 'Nested ownership map: modules/classes are areas that own their functions and methods.';
  if (layout === 'hierarchy-swimlane') return 'Swimlane hierarchy: each module becomes a lane, preserving ownership while reducing overlap.';
  if (layout === 'hierarchy-outline') return 'Outline + focused graph: hierarchy is a compact left outline; behavior flow stays on the main canvas.';
  if (layout === 'code-flow') return 'Code flow paths: entry/calls move left to right while branch/outcome/external nodes separate into lanes by marker evidence.';
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
  graph,
  onResolveEdge,
  onClearEdgeResolution,
}: {
  selection: InspectorSelection;
  graph: ExecutionFlowGraph;
  onResolveEdge: (edge: GraphEdge, certainty: 'confirmed' | 'rejected') => void;
  onClearEdgeResolution: (edge: GraphEdge) => void;
}) {
  if (!selection) {
    return (
      <section className="summaryBlock inspector">
        <h3>Inspector</h3>
        <p>Click a node or edge in the graph.</p>
      </section>
    );
  }

  if (selection.type === 'outcome') {
    const source = graph.nodes.find((node) => node.id === selection.item.sourceNodeId);
    return (
      <section className="summaryBlock inspector">
        <h3>{selection.item.type === 'error' ? 'Error outcome' : 'Success outcome'}</h3>
        <p><strong>{selection.item.trigger}</strong></p>
        <p>{selection.item.marker.evidence.reason.label}</p>
        <p>{selection.item.marker.evidence.location.path}:{selection.item.marker.evidence.location.line}</p>
        {source ? <p>From <strong>{source.label}</strong></p> : null}
        <p className="hint">Viewer-only outcome inferred from a `{selection.item.marker.kind}` Flow Marker. It shows the likely path reason without changing graph facts.</p>
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
        <NodeUsageImpact node={selection.item} graph={graph} />
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
      {selection.item.certainty === 'uncertain' || selection.item.evidence.reason.code === 'viewer_overlay_resolution' ? (
        <div className="overlayButtons">
          <button className="linkButton" type="button" onClick={() => onResolveEdge(selection.item, 'confirmed')}>Confirm edge</button>
          <button className="linkButton" type="button" onClick={() => onResolveEdge(selection.item, 'rejected')}>Reject edge</button>
          <button className="linkButton" type="button" onClick={() => onClearEdgeResolution(selection.item)}>Clear</button>
        </div>
      ) : <p className="hint">Only uncertain edges can be exported as overlay resolutions.</p>}
    </section>
  );
}

function NodeUsageImpact({ node, graph }: { node: GraphNode; graph: ExecutionFlowGraph }) {
  const impact = useMemo(() => buildNodeImpact(node, graph), [node, graph]);
  return (
    <div className="nodeImpact">
      <h4>Where this is used</h4>
      <p className="hint">Impact view across all analyzed flows.</p>
      <h5>Reachable from Entry Points</h5>
      {impact.flows.length ? <ul>{impact.flows.map((item) => <li key={item}>{item}</li>)}</ul> : <p className="hint">No Entry Point flow references this node.</p>}
      <h5>Callers</h5>
      {impact.callers.length ? <ul>{impact.callers.map((item) => <li key={item}>{item}</li>)}</ul> : <p className="hint">No callers found in graph.</p>}
      <h5>Callees / interactions</h5>
      {impact.callees.length ? <ul>{impact.callees.map((item) => <li key={item}>{item}</li>)}</ul> : <p className="hint">No callees found in graph.</p>}
    </div>
  );
}

function buildNodeImpact(node: GraphNode, graph: ExecutionFlowGraph): { flows: string[]; callers: string[]; callees: string[] } {
  const nodeById = new Map(graph.nodes.map((item) => [item.id, item]));
  const entryById = new Map(graph.entry_points.map((entry) => [entry.id, entry]));
  const flows = graph.flows
    .filter((flow) => flow.node_ids.includes(node.id))
    .map((flow) => entryById.get(flow.entry_point_id)?.label ?? flow.id)
    .sort()
    .slice(0, 8);
  const callers = graph.edges
    .filter((edge) => edge.target === node.id)
    .map((edge) => `${nodeById.get(edge.source)?.label ?? edge.source} (${edge.kind}, ${edge.certainty})`)
    .sort()
    .slice(0, 8);
  const callees = graph.edges
    .filter((edge) => edge.source === node.id)
    .map((edge) => `${nodeById.get(edge.target)?.label ?? edge.target} (${edge.kind}, ${edge.certainty})`)
    .sort()
    .slice(0, 8);
  return { flows, callers, callees };
}

interface EntryImportance {
  score: number;
  reasons: string[];
}

function entryImportance(graph: ExecutionFlowGraph, entry: EntryPoint): EntryImportance {
  const flow = graph.flows.find((item) => item.entry_point_id === entry.id);
  const label = entry.label.toLowerCase();
  const route = (entry.route_path ?? '').toLowerCase();
  const methods = new Set(entry.http_methods ?? []);
  const edgeCount = flow?.edge_ids.length ?? 0;
  const markerCount = flow?.marker_ids.length ?? 0;
  let score = Math.min(edgeCount, 30);
  const reasons: string[] = [];

  if (edgeCount) reasons.push(`${edgeCount} edge(s)`);
  if (markerCount) reasons.push(`${markerCount} marker(s)`);

  if (entry.kind === 'framework_hook') {
    score += edgeCount ? 70 : 20;
    reasons.push(edgeCount ? 'framework hook with behavior' : 'framework hook');
  } else if (entry.kind === 'web_route') {
    score += 60;
    reasons.push('web route');
  } else if (entry.kind === 'cli_command') {
    score += 45;
    reasons.push('CLI command');
  } else if (entry.kind === 'script') {
    score += 35;
    reasons.push('script entry');
  }

  if (['auth', 'login', 'token', 'user', 'session', 'current_user'].some((token) => label.includes(token) || route.includes(token))) {
    score += 35;
    reasons.push('auth/user/session signal');
  }
  if (['toggle', 'search', 'publish', 'callback'].some((token) => label.includes(token) || route.includes(token))) {
    score += 25;
    reasons.push('domain action signal');
  }
  if (['seed', 'seeder'].some((token) => label.includes(token) || route.includes(token))) {
    score -= 20;
    reasons.push('seed/setup flow de-emphasized');
  }
  if (['POST', 'PUT', 'PATCH', 'DELETE'].some((method) => methods.has(method))) {
    score += 15;
    reasons.push('mutating route');
  }
  return { score, reasons: reasons.length ? reasons : ['baseline ordering'] };
}

function entryImportanceScore(graph: ExecutionFlowGraph, entry: EntryPoint): number {
  return entryImportance(graph, entry).score;
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
    .map((entry, index) => {
      const importance = entryImportance(graph, entry);
      return {
        id: `entry:${entry.id}`,
        label: `#${index + 1} (${importance.score}) ${entry.label}`,
        kind: 'entry',
        entryPointIds: [entry.id],
      };
    });

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
  edgeResolutions: EdgeResolutions,
) {
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const edgeById = new Map(graph.edges.map((edge) => [edge.id, applyViewerResolution(edge, edgeResolutions[edge.id])]));
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

  const layoutModel = diagramLayoutModel(flowNodes, flowEdges, nodeById, layout, displayOptions.showHierarchyContext, markersByNodeId);
  const externalLane = externalLaneModel(flowNodes, layoutModel, layout, displayOptions.showHierarchyContext);
  const graphReactFlowNodes = flowNodes.map((node): FlowNode => {
    const externalIndex = externalLane?.externalIds.indexOf(node.id) ?? -1;
    const parentId = externalIndex >= 0 ? externalLane?.id : layoutModel.parentIds.get(node.id);
    const position = externalIndex >= 0 ? { x: 32, y: 72 + externalIndex * 96 } : layoutModel.positions.get(node.id) ?? { x: 0, y: 0 };
    return {
      id: node.id,
      position,
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
  const outcomeModel = codeFlowOutcomeModel(layout, flowMarkers, layoutModel, nodeById);
  const reactFlowNodes = externalLane ? [externalLane.node, ...graphReactFlowNodes, ...outcomeModel.nodes] : [...graphReactFlowNodes, ...outcomeModel.nodes];

  const reactFlowEdges = [
    ...flowEdges.map((edge): FlowEdge => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      label: edgeLabel(edge, displayOptions.edgeLabelMode),
      animated: edge.kind === 'await' || edge.kind === 'external_interaction',
      style: edgeStyle(edge),
    })),
    ...outcomeModel.edges,
  ];

  return { flowNodes, flowEdges, reactFlowNodes, reactFlowEdges, nodeById, edgeById, markersByNodeId, outcomeById: outcomeModel.outcomeById };
}

function codeFlowOutcomeModel(
  layout: DiagramLayout,
  markers: FlowMarker[],
  layoutModel: DiagramLayoutModel,
  nodeById: Map<string, GraphNode>,
): { nodes: FlowNode[]; edges: FlowEdge[]; outcomeById: Map<string, OutcomeInfo> } {
  if (layout !== 'code-flow') return { nodes: [], edges: [], outcomeById: new Map() };
  const outcomeMarkers = markers
    .filter((marker) => marker.node_id && (marker.kind === 'raise' || marker.kind === 'return'))
    .sort((a, b) => a.evidence.location.line - b.evidence.location.line || a.id.localeCompare(b.id));
  const nodes: FlowNode[] = [];
  const edges: FlowEdge[] = [];
  const outcomeById = new Map<string, OutcomeInfo>();
  const laneCounts = new Map<string, number>();

  for (const marker of outcomeMarkers) {
    const sourceId = marker.node_id!;
    if (!nodeById.has(sourceId)) continue;
    const outcomeType = marker.kind === 'raise' ? 'error' : 'success';
    const count = laneCounts.get(outcomeType) ?? 0;
    laneCounts.set(outcomeType, count + 1);
    const sourcePosition = layoutModel.positions.get(sourceId) ?? { x: 0, y: 0 };
    const id = `viewer:outcome:${marker.id}`;
    const trigger = outcomeTrigger(marker, markers);
    outcomeById.set(id, { id, type: outcomeType, sourceNodeId: sourceId, marker, trigger });
    const yBase = outcomeType === 'error' ? 260 : 760;
    nodes.push({
      id,
      position: { x: sourcePosition.x + 300, y: yBase + count * 96 },
      data: { label: `${outcomeType === 'error' ? 'Error' : 'Success'}: ${trigger} @ line ${marker.evidence.location.line}` },
      type: 'default',
      selectable: true,
      draggable: true,
      style: outcomeNodeStyle(outcomeType),
      zIndex: 3,
    });
    edges.push({
      id: `viewer:outcome-edge:${marker.id}`,
      source: sourceId,
      target: id,
      label: outcomeType === 'error' ? 'error path' : 'return path',
      animated: outcomeType === 'error',
      style: {
        stroke: outcomeType === 'error' ? '#d9480f' : '#2f9e44',
        strokeDasharray: '6 4',
        strokeWidth: 2,
      },
    });
  }
  return { nodes, edges, outcomeById };
}

function outcomeTrigger(marker: FlowMarker, markers: FlowMarker[]): string {
  const condition = markers
    .filter((candidate) => candidate.node_id === marker.node_id && candidate.kind === 'conditional' && candidate.evidence.location.line <= marker.evidence.location.line)
    .sort((a, b) => b.evidence.location.line - a.evidence.location.line)[0];
  if (condition) return `${condition.evidence.reason.label} before ${marker.kind}`;
  return marker.evidence.reason.label;
}

function outcomeNodeStyle(outcomeType: 'error' | 'success'): React.CSSProperties {
  return {
    width: 250,
    minHeight: 70,
    borderRadius: 14,
    border: `2px solid ${outcomeType === 'error' ? '#ffb08a' : '#9be7a8'}`,
    background: outcomeType === 'error' ? '#fff4ef' : '#effaf0',
    color: outcomeType === 'error' ? '#8a2f0b' : '#1b6b2a',
    fontWeight: 800,
  };
}

interface ExternalLaneModel {
  id: string;
  externalIds: string[];
  node: FlowNode;
}

function externalLaneModel(
  nodes: GraphNode[],
  layoutModel: DiagramLayoutModel,
  layout: DiagramLayout,
  showHierarchyContext: boolean,
): ExternalLaneModel | null {
  if (layout !== 'hierarchy-swimlane' || !showHierarchyContext) return null;
  const externals = nodes.filter((node) => node.kind === 'external').sort(compareHierarchyNodes);
  if (!externals.length) return null;

  const containers = nodes.filter((node) => (node.kind === 'module' || node.kind === 'class') && !layoutModel.parentIds.has(node.id));
  const containerRight = containers.length
    ? Math.max(...containers.map((node) => {
        const position = layoutModel.positions.get(node.id) ?? { x: 0, y: 0 };
        const size = layoutModel.sizes.get(node.id) ?? defaultNodeSize(node);
        return position.x + size.width;
      }))
    : 900;
  const containerTop = containers.length ? Math.min(...containers.map((node) => layoutModel.positions.get(node.id)?.y ?? 0)) : 0;
  const height = Math.max(180, 72 + externals.length * 96 + 36);
  const width = 340;
  return {
    id: 'viewer:external-interactions-lane',
    externalIds: externals.map((node) => node.id),
    node: {
      id: 'viewer:external-interactions-lane',
      position: { x: containerRight + 120, y: containerTop },
      data: { label: `External Interactions (${externals.length})` },
      type: 'default',
      selectable: false,
      draggable: true,
      style: {
        width,
        height,
        border: '2px dashed #b6c5df',
        background: '#f7faff',
        color: '#33415c',
        fontWeight: 800,
        borderRadius: 18,
        padding: 12,
      },
      zIndex: 0,
    },
  };
}

function applyViewerResolution(edge: GraphEdge, resolution: 'confirmed' | 'rejected' | undefined): GraphEdge {
  if (!resolution) return edge;
  return {
    ...edge,
    certainty: resolution,
    evidence: {
      ...edge.evidence,
      reason: {
        code: 'viewer_overlay_resolution',
        label: `Viewer Analysis Overlay marked edge as ${resolution}`,
      },
    },
  };
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
    outcomeById: new Map<string, OutcomeInfo>(),
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
  markersByNodeId: Map<string, FlowMarker[]> = new Map(),
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
  if (layout === 'code-flow') return emptyLayoutModel(codeFlowPositions(nodes, edges, nodeById, markersByNodeId));
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
    positions.set(module.id, { x: 0, y: laneY });

    const moduleFunctions = descendants.filter((node) => (node.kind === 'function' || node.kind === 'method') && directModuleParent(node, module.id, nodeById));
    moduleFunctions.forEach((node, index) => positions.set(node.id, { x: 360 + index * 300, y: laneY + 90 }));

    const classes = descendants.filter((node) => node.kind === 'class');
    let classY = laneY + 90 + (moduleFunctions.length ? 140 : 0);
    for (const cls of classes) {
      positions.set(cls.id, { x: 320, y: classY });
      const members = descendants.filter((node) => (node.kind === 'function' || node.kind === 'method') && hasAncestor(node, cls.id, nodeById));
      members.forEach((member, index) => positions.set(member.id, { x: 620 + index * 300, y: classY + 80 }));
      classY += 190;
    }

    const laneHeight = Math.max(220, classY - laneY + 90, moduleFunctions.length ? 230 : 0);
    laneY += laneHeight + 96;
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

function codeFlowPositions(
  nodes: GraphNode[],
  edges: GraphEdge[],
  nodeById: Map<string, GraphNode>,
  markersByNodeId: Map<string, FlowMarker[]>,
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  const behaviorNodes = nodes.filter((node) => node.kind !== 'module' && node.kind !== 'class').sort(compareHierarchyNodes);
  const behaviorIds = new Set(behaviorNodes.map((node) => node.id));
  const incoming = new Map<string, number>();
  const outgoing = new Map<string, string[]>();

  for (const node of behaviorNodes) {
    incoming.set(node.id, 0);
    outgoing.set(node.id, []);
  }
  for (const edge of edges) {
    if (!behaviorIds.has(edge.source) || !behaviorIds.has(edge.target)) continue;
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge.target]);
    incoming.set(edge.target, (incoming.get(edge.target) ?? 0) + 1);
  }

  const roots = behaviorNodes.filter((node) => (incoming.get(node.id) ?? 0) === 0 && node.kind !== 'external');
  const queue = (roots.length ? roots : behaviorNodes.filter((node) => node.kind !== 'external')).map((node) => node.id);
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

  const laneGroups = groupBy(behaviorNodes, (node) => codeFlowLane(node, markersByNodeId.get(node.id) ?? []));
  const laneOrder = ['entry-call', 'branch', 'loop', 'outcome', 'external', 'other'];
  const laneBaseY = new Map(laneOrder.map((lane, index) => [lane, index * 240]));
  for (const lane of laneOrder) {
    const group = (laneGroups.get(lane) ?? []).sort((a, b) => (depth.get(a.id) ?? fallbackDepth(a, nodeById)) - (depth.get(b.id) ?? fallbackDepth(b, nodeById)) || a.id.localeCompare(b.id));
    const byDepth = groupBy(group, (node) => String(depth.get(node.id) ?? fallbackDepth(node, nodeById)));
    for (const [depthKey, depthGroup] of byDepth.entries()) {
      depthGroup.sort(compareHierarchyNodes).forEach((node, index) => {
        positions.set(node.id, {
          x: 80 + Number(depthKey) * 360,
          y: (laneBaseY.get(lane) ?? 0) + index * 92,
        });
      });
    }
  }

  nodes.filter((node) => node.kind === 'module' || node.kind === 'class').forEach((node, index) => {
    positions.set(node.id, { x: 0, y: 1320 + index * 78 });
  });
  return positions;
}

function codeFlowLane(node: GraphNode, markers: FlowMarker[]): string {
  if (node.kind === 'external') return 'external';
  const markerKinds = new Set(markers.map((marker) => marker.kind));
  if (markerKinds.has('conditional') || markerKinds.has('raise')) return 'branch';
  if (markerKinds.has('loop')) return 'loop';
  if (markerKinds.has('return')) return 'outcome';
  if (node.kind === 'function' || node.kind === 'method') return 'entry-call';
  return 'other';
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

function parseLayoutOverlay(text: string): LayoutOverlayFile {
  const parsed = JSON.parse(text) as unknown;
  if (!parsed || typeof parsed !== 'object') throw new Error('Selected file is not an AVT layout overlay.');
  const overlay = parsed as Partial<LayoutOverlayFile>;
  if (overlay.kind !== 'avt-layout-overlay' || overlay.version !== 1 || !overlay.positions || typeof overlay.positions !== 'object') {
    throw new Error('Selected file is not an AVT layout overlay.');
  }
  return overlay as LayoutOverlayFile;
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
