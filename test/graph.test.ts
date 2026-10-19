import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { once } from 'node:events';
import { test } from 'node:test';
import { createApp } from '../src/app.ts';
import { buildGraph, dataFile } from '../src/graph.ts';
import { parseFilters, queryGraph, QueryError } from '../src/query.ts';
import type { Filter, GraphInput } from '../src/types.ts';

const source = await readFile(dataFile, 'utf8');
const input: GraphInput = JSON.parse(source);
const before = structuredClone(input);
const warnings: string[] = [];
const supplied = buildGraph(input, message => warnings.push(message));
const fixture = buildGraph({
  nodes: [
    { name: 'A', publicExposed: true },
    { name: 'V1', vulnerabilities: ['v1'] },
    { name: 'C', publicExposed: false, vulnerabilities: [] },
    { name: 'B' },
    { name: 'V2', vulnerabilities: ['v2'] },
    { name: 'DB', kind: 'rds' },
    { name: 'Q', kind: 'sqs' },
  ],
  edges: [
    { from: 'A', to: ['V1', 'C'] }, { from: 'V1', to: 'B' },
    { from: 'C', to: ['B', 'DB'] }, { from: 'B', to: ['DB', 'V2'] },
    { from: 'V2', to: 'DB' },
  ],
});
const eq = (scope: Filter['scope'], field: Filter['field'], value: string | boolean): Filter =>
  ({ scope, field, operator: 'eq', value });
const vulnerable: Filter = { scope: 'any', field: 'vulnerabilities', operator: 'notEmpty' };
const securityFilters = [eq('start', 'publicExposed', true), eq('end', 'kind', 'rds'), vulnerable];
const query = (filters: Filter[]) => queryGraph(fixture, filters);
const expectedRoutes = [['A', 'V1', 'B', 'DB'], ['A', 'V1', 'B', 'V2', 'DB'], ['A', 'C', 'B', 'V2', 'DB']];

test('supplied JSON is preserved and normalized to the documented graph', async () => {
  assert.deepEqual(input, before);
  assert.equal(await readFile(dataFile, 'utf8'), source);
  assert.equal(supplied.nodesById.size, 47);
  assert.equal(supplied.edges.length, 98);
  assert.equal(supplied.routes.length, 487);
  assert.equal(supplied.routes.filter(route => route.length === 1).length, 47);
  assert.deepEqual(supplied.outgoing.get('consign-service'), ['consign-price-service']);
  assert.deepEqual(supplied.nodesById.get('assurance-service'), {
    id: 'assurance-service', name: 'assurance-service', unresolved: true,
  });
  assert.deepEqual(supplied.edges.filter(edge => edge.target === 'assurance-service'), [
    { source: 'preserve-other-service', target: 'assurance-service' },
    { source: 'preserve-service', target: 'assurance-service' },
  ]);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /assurance-service/);
  assert.deepEqual(supplied.outgoing.get('gateway-service'), []);
  assert.ok(supplied.routes.some(route => route.length === 1 && route[0] === 'gateway-service'));
});

test('unfiltered results contain the complete graph, including isolated nodes', () => {
  const result = queryGraph(supplied, parseFilters({ filters: [] }));
  assert.deepEqual(result.graph.nodes, [...supplied.nodesById.values()]);
  assert.deepEqual(result.graph.edges, supplied.edges);
  assert.deepEqual(result.routes, supplied.routes);
});

test('supplied-data queries match documented examples', () => {
  assert.deepEqual(queryGraph(supplied, securityFilters), { graph: { nodes: [], edges: [] }, routes: [] });
  assert.deepEqual(queryGraph(supplied, [eq('start', 'name', 'user-service'), eq('end', 'kind', 'rds')]).routes,
    [['user-service', 'auth-service', 'prod-postgresdb']]);
  const publicRoutes = queryGraph(supplied, [eq('start', 'publicExposed', true)]).routes;
  assert.equal(publicRoutes.length, 8);
  assert.ok(publicRoutes.some(route => route.length === 1 && route[0] === 'gateway-service'));
});

test('filters combine on one route and separate any filters can match different nodes', () => {
  assert.deepEqual(query(securityFilters).routes, expectedRoutes);
  assert.deepEqual(query(securityFilters.map(filter => ({ ...filter, scope: 'any' }))).routes, expectedRoutes);
  assert.deepEqual(query([eq('any', 'name', 'V1'), eq('any', 'name', 'C')]).routes, []);
  assert.deepEqual(query([eq('start', 'name', 'B'), eq('end', 'name', 'V2')]).routes, [['B', 'V2']]);
});

test('any includes endpoints, and every scope can match a singleton', () => {
  for (const scope of ['start', 'end', 'any'] as const) {
    const filters = [eq('start', 'name', 'V1'), eq('end', 'name', 'V1'), { ...vulnerable, scope }];
    assert.deepEqual(query(filters).routes, [['V1']]);
  }
  assert.deepEqual(query([eq('start', 'name', 'A'), eq('end', 'name', 'V1'), vulnerable]).routes, [['A', 'V1']]);
  assert.deepEqual(query([eq('start', 'name', 'V1'), eq('end', 'name', 'B'), vulnerable]).routes, [['V1', 'B']]);
});

test('missing attributes do not match false, true, or notEmpty', () => {
  for (const value of [false, true]) {
    assert.deepEqual(query([eq('start', 'name', 'B'), eq('start', 'publicExposed', value)]).routes, []);
  }
  assert.deepEqual(query([eq('start', 'name', 'B'), { ...vulnerable, scope: 'start' }]).routes, []);
  assert.deepEqual(query([eq('start', 'name', 'C'), { ...vulnerable, scope: 'start' }]).routes, []);
  assert.ok(query([eq('start', 'publicExposed', false)]).routes.some(route => route[0] === 'C'));
});

test('the union retains healthy intermediates and only edges actually used by matched routes', () => {
  const { graph, routes } = query(securityFilters);
  assert.deepEqual(routes, expectedRoutes);
  assert.deepEqual(graph.nodes.map(node => node.id), ['A', 'V1', 'C', 'B', 'V2', 'DB']);
  const edgeIds = graph.edges.map(edge => `${edge.source}>${edge.target}`);
  assert.equal(new Set(edgeIds).size, edgeIds.length);
  assert.ok(!edgeIds.includes('C>DB')); // Both nodes appear, but this shortcut matches no route.
  assert.ok(['A>C', 'C>B', 'B>DB'].every(edge => edgeIds.includes(edge)));
  assert.ok(!routes.some(route => route.join('>') === 'A>C>B>DB')); // Recombination is not a matched route.
});

test('eq, in, and notEmpty accept supported values without coercion', () => {
  assert.deepEqual(query(parseFilters({ filters: [{ scope: 'end', field: 'kind', operator: 'in', value: ['rds', 'sqs'] }] })).routes,
    query([eq('end', 'kind', 'rds')]).routes.concat([['Q']]));
  assert.deepEqual(query(parseFilters({ filters: [{ scope: 'start', field: 'name', operator: 'in', value: [] }] })).routes, []);
  assert.deepEqual(query(parseFilters({ filters: [vulnerable] })), query([vulnerable]));
  const base = eq('start', 'publicExposed', true);
  const invalid = [
    null, {}, [], { filters: null }, { filters: [null] },
    ...[
      { scope: 'all' }, { field: 'metadata' }, { field: '__proto__' }, { field: 'constructor' },
      { operator: 'contains' }, { operator: 'toString' }, { operator: '__proto__' },
      { value: 'true' }, { value: 1 }, { value: null }, { value: undefined },
      { operator: 'in', value: [true, 'false'] }, { operator: 'in', value: true },
      { field: 'name', value: false }, { field: 'kind', operator: 'in', value: [1] },
      { field: 'vulnerabilities', operator: 'eq', value: [] },
      { operator: 'notEmpty', value: undefined },
      { field: 'vulnerabilities', operator: 'notEmpty', value: true },
    ].map(change => ({ filters: [{ ...base, ...change }] })),
  ];
  for (const body of invalid) assert.throws(() => parseFilters(body), QueryError, JSON.stringify(body));
});

test('HTTP queries return JSON for valid, empty, invalid, and malformed requests', async t => {
  const server = createApp(fixture).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
    server.closeAllConnections();
  }));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const send = (body: string) => fetch(`http://127.0.0.1:${address.port}/graph/query`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
  });
  const valid = await send(JSON.stringify({ filters: securityFilters }));
  assert.equal(valid.status, 200);
  assert.deepEqual(await valid.json(), query(securityFilters));
  const empty = await send(JSON.stringify({ filters: [eq('start', 'name', 'absent')] }));
  assert.equal(empty.status, 200);
  assert.deepEqual(await empty.json(), { graph: { nodes: [], edges: [] }, routes: [] });
  for (const body of ['{}', '{"filters":[{"scope":"wrong"}]}', '{broken']) {
    const response = await send(body);
    assert.equal(response.status, 400);
    assert.match(response.headers.get('content-type')!, /application\/json/);
    assert.equal(typeof (await response.json()).error, 'string');
  }
});
