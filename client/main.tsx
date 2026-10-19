/// <reference types="vite/client" />
import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import cytoscape, { type Core } from 'cytoscape';
import type { Filter, QueryResult } from '../src/types';

const choices: { label: string; filter: Filter }[] = [
  { label: 'Starts at a public service', filter: { scope: 'start', field: 'publicExposed', operator: 'eq', value: true } },
  { label: 'Ends at an RDS database', filter: { scope: 'end', field: 'kind', operator: 'eq', value: 'rds' } },
  { label: 'Contains a vulnerable node', filter: { scope: 'any', field: 'vulnerabilities', operator: 'notEmpty' } },
];
const emptyQuery = JSON.stringify({ filters: [] }, null, 2);
const exampleQuery = JSON.stringify({ filters: [
  { scope: 'start', field: 'name', operator: 'eq', value: 'user-service' },
  { scope: 'end', field: 'kind', operator: 'eq', value: 'rds' },
] }, null, 2);
const edgeId = (source: string, target: string) => `edge:${JSON.stringify([source, target])}`;

function Graph({ graph, route }: { graph: QueryResult['graph']; route?: readonly string[] }) {
  const container = useRef<HTMLDivElement>(null);
  const instance = useRef<Core | null>(null);

  useEffect(() => {
    const layout = { name: 'grid' as const, animate: false, padding: 30, avoidOverlap: true, avoidOverlapPadding: 24 };
    const cy = cytoscape({
      container: container.current,
      elements: [
        ...graph.nodes.map(node => ({
          data: { id: node.id, label: node.name + (node.unresolved ? '\n(unresolved)' : '') },
          classes: [node.publicExposed && 'public', node.vulnerabilities?.length && 'vulnerable', node.kind === 'rds' && 'database', node.unresolved && 'unresolved'].filter(Boolean).join(' '),
        })),
        ...graph.edges.map(edge => ({ data: { ...edge, id: edgeId(edge.source, edge.target) } })),
      ],
      layout,
      style: [
        { selector: 'node', style: { label: 'data(label)', 'background-color': '#e8edf1', 'border-color': '#8996a3', 'border-width': 2, width: 110, height: 52, shape: 'round-rectangle', 'font-size': 11, color: '#22313e', 'text-valign': 'center', 'text-wrap': 'wrap', 'text-max-width': '100px' } },
        { selector: 'edge', style: { width: 1.5, 'line-color': '#aab5c0', 'target-arrow-color': '#aab5c0', 'target-arrow-shape': 'triangle', 'curve-style': 'bezier' } },
        { selector: '.public', style: { 'border-color': '#18806b', 'border-width': 4 } },
        { selector: '.vulnerable', style: { 'background-color': '#ffe1da', 'border-color': '#c7563d' } },
        { selector: '.database', style: { 'background-color': '#dce7ff', 'border-color': '#526fba' } },
        { selector: '.unresolved', style: { 'background-color': '#fff2cb', 'border-color': '#ad8120', 'border-style': 'dashed' } },
        { selector: '.muted', style: { opacity: 0.12 } },
        { selector: 'edge.highlighted', style: { width: 4, 'line-color': '#12675f', 'target-arrow-color': '#12675f' } },
      ],
      minZoom: 0.1,
      maxZoom: 3,
    });
    instance.current = cy;
    const observer = new ResizeObserver(() => { cy.resize(); cy.layout(layout).run(); });
    observer.observe(container.current!);
    return () => { observer.disconnect(); cy.destroy(); instance.current = null; };
  }, [graph]);

  useEffect(() => {
    const cy = instance.current;
    if (!cy) return;
    cy.elements().removeClass('muted highlighted');
    if (route) {
      cy.elements().addClass('muted');
      route.forEach((id, index) => {
        cy.getElementById(id).removeClass('muted');
        if (index > 0) cy.getElementById(edgeId(route[index - 1]!, id)).removeClass('muted').addClass('highlighted');
      });
    }
  }, [graph, route]);

  return <>
    <div className="graph-tools">
      <span>Scroll to zoom · Drag the background to pan</span>
      <button type="button" onClick={() => instance.current?.fit(undefined, 30)}>Fit graph</button>
    </div>
    <div className="graph" ref={container} role="img" aria-label="Directed service graph. Use the matching route selector to read individual paths." />
  </>;
}

function App() {
  const [mode, setMode] = useState('basic');
  const [checked, setChecked] = useState<boolean[]>([false, false, false]);
  const [advanced, setAdvanced] = useState(emptyQuery);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [selected, setSelected] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function query(body: string) {
    setLoading(true);
    setError('');
    setResult(null);
    setSelected('');
    try {
      JSON.parse(body);
      const response = await fetch('/graph/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? `The query failed (HTTP ${response.status}). Please try again.`);
      setResult(data);
    } catch (cause) {
      setError(cause instanceof SyntaxError ? `Invalid JSON: ${cause.message}` : cause instanceof Error ? cause.message : 'Unable to load the graph. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void query(emptyQuery); }, []);
  const route = selected === '' ? undefined : result?.routes[Number(selected)];
  const unresolved = result?.graph.nodes.filter(node => node.unresolved) ?? [];

  return <main>
    <header><h1>Explore service routes</h1></header>

    <form className="panel filters" onSubmit={event => {
      event.preventDefault();
      void query(mode === 'advanced' ? advanced : JSON.stringify({ filters: choices.filter((_, index) => checked[index]).map(choice => choice.filter) }));
    }}>
      <fieldset disabled={loading}>
        <legend>Route filters</legend>
        <div className="mode-switch" role="radiogroup" aria-label="Filter mode">
          {['basic', 'advanced'].map(value => <label key={value}>
            <input type="radio" name="mode" value={value} checked={mode === value} onChange={() => { setMode(value); setError(''); }} />
            {value === 'basic' ? 'Basic' : 'Advanced'}
          </label>)}
        </div>
        {mode === 'basic' ? <div className="filter-options">
          {choices.map((choice, index) => <label key={choice.label}>
            <input type="checkbox" checked={checked[index]} onChange={event => setChecked(checked.map((value, i) => i === index ? event.target.checked : value))} />
            {choice.label}
          </label>)}
        </div> : <div className="advanced">
          <label htmlFor="query-body">JSON request body</label>
          <textarea id="query-body" rows={10} value={advanced} onChange={event => setAdvanced(event.target.value)} spellCheck={false} aria-describedby="query-help" />
          <p id="query-help" className="hint">Each filter has a scope (<code>start</code>, <code>end</code>, or <code>any</code>), field, and operator. For <code>name</code>, <code>kind</code>, or <code>publicExposed</code>, use <code>eq</code> with a value or <code>in</code> with an array of values. For <code>vulnerabilities</code>, use <code>notEmpty</code> without a value. All filters must match the same route.</p>
          <button type="button" onClick={() => setAdvanced(exampleQuery)}>Load example</button>
        </div>}
        <div className="actions">
          <button className="primary" type="submit">Apply filters</button>
          <button type="button" onClick={() => { setChecked([false, false, false]); setAdvanced(emptyQuery); void query(emptyQuery); }}>Reset</button>
          <span>No filters returns all routes.</span>
        </div>
      </fieldset>
      {error && <p className="error" role="alert">{error}</p>}
    </form>

    {(loading || result) && <section className="panel results" aria-label="Query results" aria-busy={loading}>
      {loading && <p className="message" role="status">Loading routes…</p>}
      {result && <>
        <div className="result-heading">
          <h2>Matching routes</h2>
          <p role="status">{result.routes.length} routes · {result.graph.nodes.length} nodes · {result.graph.edges.length} edges</p>
        </div>
        {result.routes.length === 0 ? <div className="message">
          <h3>No matching routes</h3>
          <p>No route in the supplied graph matches every filter. Try changing or removing a filter.</p>
        </div> : <>
          <label className="route-picker">Highlight a matching route
            <select value={selected} onChange={event => setSelected(event.target.value)}>
              <option value="">Show combined graph</option>
              {result.routes.map((path, index) => <option key={index} value={index}>{path.join(' → ')}</option>)}
            </select>
          </label>
          <p className="hint">The combined graph may contain other paths. Select a returned route to highlight its exact connections.</p>
          {route && <ol className="route">{route.map(id => <li key={id}>{id}{unresolved.some(node => node.id === id) && ' (unresolved)'}</li>)}</ol>}
          <div className="legend" aria-label="Graph legend">
            <span><i className="service" />Service / resource</span>
            <span><i className="public" />Public</span>
            <span><i className="vulnerable" />Vulnerable</span>
            <span><i className="database" />RDS</span>
            <span><i className="unresolved" />Unresolved</span>
          </div>
          <Graph graph={result.graph} route={route} />
          {unresolved.length > 0 && <p className="notice">{unresolved.map(node => node.name).join(', ')}: referenced in the JSON, but its definition is missing. Attributes are unknown.</p>}
        </>}
      </>}
    </section>}
  </main>;
}

const root = createRoot(document.getElementById('root')!);
root.render(<App />);
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount());
