import express from 'express';
import type { ErrorRequestHandler } from 'express';
import type { GraphSnapshot } from './graph.ts';
import { parseFilters, queryGraph, QueryError } from './query.ts';

export function createApp(graph: GraphSnapshot) {
  const app = express();
  app.use(express.json());
  app.post('/graph/query', (req, res) => {
    res.json(queryGraph(graph, parseFilters(req.body)));
  });

  const handleError: ErrorRequestHandler = (error, _req, res, _next) => {
    if (error instanceof QueryError) {
      res.status(400).json({ error: error.message });
    } else if (error.type === 'entity.parse.failed') {
      res.status(400).json({ error: 'Request body must be valid JSON.' });
    } else {
      console.error(error);
      res.status(error.status || 500).json({ error: 'Unable to process the request.' });
    }
  };
  app.use(handleError);
  return app;
}
