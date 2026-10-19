export type NodeId = string;

export interface InputNode {
  name: string;
  kind?: string;
  publicExposed?: boolean;
  vulnerabilities?: unknown[];
  [attribute: string]: unknown;
}

export interface GraphNode extends InputNode {
  id: NodeId;
  unresolved?: true;
}

export interface GraphEdge {
  source: NodeId;
  target: NodeId;
}

export interface GraphInput {
  nodes: InputNode[];
  edges: { from: NodeId; to: NodeId | NodeId[] }[];
}

export interface Filter {
  scope: 'start' | 'end' | 'any';
  field: 'name' | 'kind' | 'publicExposed' | 'vulnerabilities';
  operator: 'eq' | 'in' | 'notEmpty';
  value?: string | boolean | (string | boolean)[];
}

export interface QueryResult {
  graph: { nodes: GraphNode[]; edges: GraphEdge[] };
  routes: readonly NodeId[][];
}
