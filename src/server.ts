import express from 'express';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.ts';
import { loadGraph } from './graph.ts';

try {
  const port = Number(process.env.PORT || 3000);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error('PORT must be an integer between 0 and 65535.');
  }

  const graph = await loadGraph();
  const app = createApp(graph);
  const server = createServer(app);
  if (process.argv.includes('--dev')) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({ server: { middlewareMode: true, hmr: { server } } });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(fileURLToPath(new URL('../dist/', import.meta.url))));
  }

  server.listen(port, '127.0.0.1', () => {
    const address = server.address() as AddressInfo;
    console.info(`Loaded ${graph.nodesById.size} nodes, ${graph.edges.length} edges, ${graph.routes.length} routes.`);
    console.info(`Train Ticket Graph: http://localhost:${address.port}`);
  }).on('error', error => {
    console.error(`Server failed: ${error.message}`);
    process.exit(1);
  });
} catch (error) {
  console.error(`Startup failed: ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
}
