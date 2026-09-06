import { Router } from 'express';
import { MovieRegistry } from '../services/movieRegistry.js';
import { TranscodingQueue } from '../services/transcodingQueue.js';

export function createHealthRouter(registry: MovieRegistry, queue: TranscodingQueue): Router {
  const router = Router();

  router.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      movies: registry.count(),
      ready: registry.countByStatus('ready'),
      transcoding: queue.activeCount,
      queued: queue.queuedCount,
    });
  });

  return router;
}
