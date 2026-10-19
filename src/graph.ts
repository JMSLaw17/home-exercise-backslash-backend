import { readFile } from 'node:fs/promises';
import type { GraphEdge, GraphInput, GraphNode, NodeId } from './types.ts';

export interface GraphSnapshot {
  nodesById: ReadonlyMap<NodeId, GraphNode>;
  edges: readonly GraphEdge[];
  outgoing: ReadonlyMap<NodeId, readonly NodeId[]>;
  routes: readonly NodeId[][];
}

export const dataFile = new URL('../train-ticket-be (1).json', import.meta.url);

export async function loadGraph(file: string | URL = dataFile): Promise<GraphSnapshot> {
  return buildGraph(JSON.parse(await readFile(file, 'utf8')) as GraphInput);
}

export function buildGraph(input: GraphInput, warn = console.warn): GraphSnapshot {
  const nodesById = new Map<NodeId, GraphNode>(
    input.nodes.map(node => [node.name, { ...node, id: node.name }]),
  );
  const edges = input.edges.flatMap(({ from, to }) =>
    (Array.isArray(to) ? to : [to]).map(target => ({ source: from, target })),
  );

  for (const { source, target } of edges) {
    for (const id of [source, target]) {
      if (!nodesById.has(id)) {
        nodesById.set(id, { id, name: id, unresolved: true });
        warn(`Missing node definition: ${id}. Keeping an unresolved placeholder.`);
      }
    }
  }

  const outgoing = new Map([...nodesById.keys()].map(id => [id, [] as NodeId[]]));
  for (const { source, target } of edges) outgoing.get(source)!.push(target);

  const routes: NodeId[][] = [];
  // The supplied graph is acyclic. Every prefix, including a singleton, is a route.
  function visit(id: NodeId, prefix: NodeId[]) {
    const route = [...prefix, id];
    routes.push(route);
    for (const next of outgoing.get(id)!) visit(next, route);
  }
  for (const id of nodesById.keys()) visit(id, []);

  return { nodesById, edges, outgoing, routes };
}
