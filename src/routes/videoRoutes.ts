import { Router, Request, Response, static as expressStatic } from 'express';
import path from 'path';
import { MovieRegistry } from '../services/movieRegistry.js';
import { Movie } from '../types/movie.js';
import { isValidMovieId } from '../utils/slug.js';
import { resolveAndVerifyPath } from '../utils/filesystem.js';
import { logger } from '../utils/logger.js';

/** Public-facing movie representation — no internal filesystem paths */
function toPublicMovie(movie: Movie) {
  return {
    id: movie.id,
    title: movie.title,
    filename: movie.filename,
    status: movie.status,
    /** true if the original source file is present; false if only HLS remains */
    sourceAvailable: movie.sourceAvailable ?? true,
    sizeBytes: movie.sizeBytes,
    durationSeconds: movie.durationSeconds,
    width: movie.width,
    height: movie.height,
    videoCodec: movie.videoCodec,
    audioCodec: movie.audioCodec,
    createdAt: movie.createdAt,
    updatedAt: movie.updatedAt,
    playUrl: `/videos/${movie.id}/play`,
    ...(movie.status === 'processing'
      ? {
          transcodingProgress: movie.transcodingProgress ?? 0,
          transcodingProfile: movie.transcodingProfile ?? null,
        }
      : {}),
    ...(movie.status === 'failed' && movie.error ? { error: movie.error } : {}),
  };
}

export function createVideoRouter(registry: MovieRegistry, hlsDirectory: string): Router {
  const router = Router();

  // ─── GET /videos ───────────────────────────────────────────────────────────
  router.get('/videos', (_req, res) => {
    const movies = registry.getAll().map(toPublicMovie);
    res.json(movies);
  });

  // ─── GET /videos/:id ───────────────────────────────────────────────────────
  router.get('/videos/:id', (req: Request, res: Response) => {
    const { id } = req.params;

    if (!id || !isValidMovieId(id)) {
      res.status(400).json({ error: 'Invalid movie ID' });
      return;
    }

    const movie = registry.get(id);
    if (!movie) {
      res.status(404).json({ error: 'Movie not found' });
      return;
    }

    res.json(toPublicMovie(movie));
  });

  // ─── GET /videos/:id/progress ──────────────────────────────────────────────
  router.get('/videos/:id/progress', (req: Request, res: Response) => {
    const { id } = req.params;

    if (!id || !isValidMovieId(id)) {
      res.status(400).json({ error: 'Invalid movie ID' });
      return;
    }

    const movie = registry.get(id);
    if (!movie) {
      res.status(404).json({ error: 'Movie not found' });
      return;
    }

    res.json({
      id: movie.id,
      status: movie.status,
      /** 0–100, only meaningful when status === 'processing' */
      progress: movie.status === 'processing' ? (movie.transcodingProgress ?? 0) : null,
      /** Current quality profile being transcoded (e.g. '720p'), or null */
      profile: movie.status === 'processing' ? (movie.transcodingProfile ?? null) : null,
    });
  });

  // ─── GET /videos/:id/play ──────────────────────────────────────────────────
  router.get('/videos/:id/play', (req: Request, res: Response) => {
    const { id } = req.params;

    if (!id || !isValidMovieId(id)) {
      res.status(400).json({ error: 'Invalid movie ID' });
      return;
    }

    const movie = registry.get(id);

    if (!movie) {
      res.status(404).json({ error: 'Movie not found' });
      return;
    }

    switch (movie.status) {
      case 'ready':
        // Redirect to the HLS master playlist
        res.redirect(302, `/hls/${id}/master.m3u8`);
        break;

      case 'processing':
        res.status(409).json({
          error: 'Movie is still being processed',
          status: movie.status,
        });
        break;

      case 'queued':
        res.status(409).json({
          error: 'Movie is queued for processing',
          status: movie.status,
        });
        break;

      case 'discovered':
        res.status(409).json({
          error: 'Movie has been discovered but not yet queued for processing',
          status: movie.status,
        });
        break;

      case 'failed':
        res.status(500).json({
          error: 'Transcoding failed for this movie',
          status: movie.status,
        });
        break;

      default:
        res.status(500).json({ error: 'Unknown movie status' });
    }
  });

  // ─── GET /hls/:id/* — Static HLS file serving ──────────────────────────────
  // Custom handler to:
  //   1. Validate the movie ID
  //   2. Verify the resolved path stays within hlsDirectory (path traversal protection)
  //   3. Set correct MIME types for .m3u8 and .ts
  router.get('/hls/:id/*', (req: Request, res: Response) => {
    const { id } = req.params;
    const rest = (req.params as Record<string, string>)['0'] ?? '';

    if (!id || !isValidMovieId(id)) {
      res.status(400).json({ error: 'Invalid movie ID' });
      return;
    }

    // Prevent path traversal
    let filePath: string;
    try {
      filePath = resolveAndVerifyPath(hlsDirectory, id, rest);
    } catch {
      logger.warn(`Path traversal attempt blocked: id=${id}, rest=${rest}`);
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    const ext = path.extname(filePath).toLowerCase();

    // Set MIME type based on extension
    if (ext === '.m3u8') {
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      // Playlists: no aggressive caching
      res.setHeader('Cache-Control', 'no-cache, no-store');
    } else if (ext === '.ts') {
      res.setHeader('Content-Type', 'video/mp2t');
      // Segments: can be cached
      res.setHeader('Cache-Control', 'public, max-age=3600');
    }

    res.sendFile(filePath, (err) => {
      if (err) {
        if (!res.headersSent) {
          res.status(404).json({ error: 'HLS file not found' });
        }
      }
    });
  });

  return router;
}
