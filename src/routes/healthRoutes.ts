import { Router } from 'express';
import { MovieRegistry } from '../services/movieRegistry.js';
import { TranscodingQueue } from '../services/transcodingQueue.js';

export function createHealthRouter(registry: MovieRegistry, queue: TranscodingQueue): Router {
  const router = Router();

  const handleHealth = (_req: any, res: any) => {
    res.json({
      status: 'ok',
      movies: registry.count(),
      ready: registry.countByStatus('ready'),
      transcoding: queue.activeCount,
      queued: queue.queuedCount,
    });
  };

  router.get('/health', handleHealth);
  router.get('/api/health', handleHealth);

  return router;
}
