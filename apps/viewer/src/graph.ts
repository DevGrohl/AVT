export type Certainty = 'confirmed' | 'uncertain' | 'rejected';
export type EntryPointKind = 'web_route' | 'framework_hook' | 'cli_command' | 'script' | 'manual';
export type NodeKind = 'project' | 'module' | 'class' | 'function' | 'method' | 'external';
export type EdgeKind = 'call' | 'await' | 'external_interaction' | 'inheritance' | 'override';
export type FlowMarkerKind = 'conditional' | 'raise' | 'return' | 'async' | 'loop';

export interface SourceLocation {
  path: string;
  line: number;
  column: number;
  end_line?: number;
  end_column?: number;
}

export interface DetectionReason {
  code: string;
  label: string;
}

export interface Evidence {
  location: SourceLocation;
  reason: DetectionReason;
}

export interface GraphMetadata {
  schema_version: string;
  analyzer_version: string;
  generated_at?: string;
  project_name: string;
}

export interface GraphNode {
  id: string;
  kind: NodeKind;
  label: string;
  path?: string;
  qualified_name?: string;
  signature?: string;
  type_hints?: Record<string, string>;
  parent_id?: string;
}

export interface GraphEdge {
  id: string;
  kind: EdgeKind;
  source: string;
  target: string;
  certainty: Certainty;
  evidence: Evidence;
}

export interface EntryPoint {
  id: string;
  kind: EntryPointKind;
  node_id: string;
  label: string;
  evidence: Evidence;
  route_path?: string;
  http_methods?: string[];
}

export interface FlowMarker {
  id: string;
  kind: FlowMarkerKind;
  node_id?: string;
  edge_id?: string;
  evidence: Evidence;
}

export interface ExecutionFlow {
  id: string;
  entry_point_id: string;
  node_ids: string[];
  edge_ids: string[];
  marker_ids: string[];
}

export interface GraphWarning {
  code: string;
  message: string;
  location?: SourceLocation;
}

export interface GuideSuggestion {
  entry: string;
  kind: string;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
  risk: string;
}

export interface GuideFile {
  suggested_entry_points: GuideSuggestion[];
  project_observations: string[];
  safe_project_summary?: unknown;
  llm_prompt?: string;
}

export interface ExecutionFlowGraph {
  metadata: GraphMetadata;
  entry_points: EntryPoint[];
  flows: ExecutionFlow[];
  nodes: GraphNode[];
  edges: GraphEdge[];
  markers: FlowMarker[];
  warnings: GraphWarning[];
}

export function isGuideFile(value: unknown): value is GuideFile {
  if (!value || typeof value !== 'object') return false;
  const guide = value as Partial<GuideFile>;
  return Array.isArray(guide.suggested_entry_points) && Array.isArray(guide.project_observations);
}

export function isExecutionFlowGraph(value: unknown): value is ExecutionFlowGraph {
  if (!value || typeof value !== 'object') return false;
  const graph = value as Partial<ExecutionFlowGraph>;
  return Boolean(
    graph.metadata &&
      Array.isArray(graph.entry_points) &&
      Array.isArray(graph.flows) &&
      Array.isArray(graph.nodes) &&
      Array.isArray(graph.edges) &&
      Array.isArray(graph.markers) &&
      Array.isArray(graph.warnings),
  );
}
