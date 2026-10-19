import type { GraphSnapshot } from './graph.ts';
import type { Filter, NodeId, QueryResult } from './types.ts';

type FieldType = 'string' | 'boolean' | 'array';
const fields: Record<Filter['field'], FieldType> = {
  name: 'string',
  kind: 'string',
  publicExposed: 'boolean',
  vulnerabilities: 'array',
};

const scalar = (type: FieldType, value: unknown) => type !== 'array' && typeof value === type;
const operators: Record<Filter['operator'], {
  valid: (type: FieldType, value: unknown) => boolean;
  createMatcher: (expected: unknown) => (actual: unknown) => boolean;
}> = {
  eq: { valid: scalar, createMatcher: expected => actual => actual === expected },
  in: {
    valid: (type, value) => type !== 'array' && Array.isArray(value) && value.every(v => scalar(type, v)),
    createMatcher: expected => {
      const values = new Set(expected as unknown[]);
      return actual => values.has(actual);
    },
  },
  notEmpty: {
    valid: (type, value) => type === 'array' && value === undefined,
    createMatcher: () => actual => Array.isArray(actual) && actual.length > 0,
  },
};

export class QueryError extends Error {}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseFilters(body: unknown): Filter[] {
  if (!isObject(body) || !Array.isArray(body.filters)) {
    throw new QueryError('Request body must contain a filters array.');
  }

  return body.filters.map((filter: unknown, i) => {
    const invalid = (message: string): never => { throw new QueryError(`filters[${i}]: ${message}`); };
    if (!isObject(filter)) return invalid('expected a filter object.');
    const { scope, field, operator, value } = filter;
    if (scope !== 'start' && scope !== 'end' && scope !== 'any') {
      return invalid('scope must be start, end, or any.');
    }
    if (typeof field !== 'string' || !Object.hasOwn(fields, field)) {
      return invalid(`field must be one of: ${Object.keys(fields).join(', ')}.`);
    }
    if (typeof operator !== 'string' || !Object.hasOwn(operators, operator)) {
      return invalid(`operator must be one of: ${Object.keys(operators).join(', ')}.`);
    }
    const fieldName = field as Filter['field'];
    const operatorName = operator as Filter['operator'];
    if (!operators[operatorName].valid(fields[fieldName], value)) {
      return invalid(`unsupported operator or value for ${field}.`);
    }
    return { scope, field: fieldName, operator: operatorName, value } as Filter;
  });
}

export function queryGraph(snapshot: GraphSnapshot, filters: readonly Filter[]): QueryResult {
  const predicates = filters.map(({ scope, field, operator, value }) => {
    const matchesValue = operators[operator].createMatcher(value);
    const matches = (id: NodeId) => matchesValue(snapshot.nodesById.get(id)![field]);
    return (route: NodeId[]) => scope === 'start' ? matches(route[0])
      : scope === 'end' ? matches(route[route.length - 1]) : route.some(matches);
  });
  const routes = snapshot.routes.filter(route => predicates.every(matches => matches(route)));
  const nodeIds = new Set(routes.flat());
  const edgeIds = new Set<string>();
  for (const route of routes) {
    for (let i = 1; i < route.length; i++) edgeIds.add(JSON.stringify([route[i - 1], route[i]]));
  }

  return {
    graph: {
      nodes: [...snapshot.nodesById.values()].filter(node => nodeIds.has(node.id)),
      edges: snapshot.edges.filter(({ source, target }) => edgeIds.has(JSON.stringify([source, target]))),
    },
    routes,
  };
}
