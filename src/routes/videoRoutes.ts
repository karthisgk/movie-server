import { Router, Request, Response, static as expressStatic } from 'express';
import path from 'path';
import { MovieRegistry } from '../services/movieRegistry.js';
import { Movie } from '../types/movie.js';
import { isValidMovieId } from '../utils/slug.js';
import { resolveAndVerifyPath, fileExists } from '../utils/filesystem.js';
import { logger } from '../utils/logger.js';
import { listExtractedSubtitles } from '../services/subtitleService.js';
import { getMediaInfo } from '../services/ffmpegService.js';
import { readHlsMetadata } from '../services/hlsService.js';
import { ensureAudioTrackExtracted, generateMasterPlaylistContent } from '../services/audioExtractionService.js';
import { resolveSourceAudioIndex } from '../services/audioTrackPrioritizer.js';

/** Public-facing movie representation — no internal filesystem paths */
function toPublicMovie(movie: Movie) {
  const isActivelyTranscoding = movie.status === 'processing' || movie.status === 'partial';
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
    audioTracks: movie.audioTracks,
    createdAt: movie.createdAt,
    updatedAt: movie.updatedAt,
    playUrl: `/videos/${movie.id}/play`,
    ...(isActivelyTranscoding
      ? {
          transcodingProgress: movie.transcodingProgress ?? 0,
          transcodingProfile: movie.transcodingProfile ?? null,
          /** Profiles that have finished transcoding and are available to stream. */
          completedProfiles: movie.completedProfiles ?? [],
        }
      : {}),
    ...(movie.status === 'ready' && movie.completedProfiles
      ? { completedProfiles: movie.completedProfiles }
      : {}),
    ...(movie.status === 'failed' && movie.error ? { error: movie.error } : {}),
  };
}

export function createVideoRouter(registry: MovieRegistry, hlsDirectory: string, ffmpegPath?: string, ffprobePath?: string): Router {
  const router = Router();

  // ─── GET /videos ───────────────────────────────────────────────────────────
  router.get('/videos', (_req, res) => {
    const movies = registry.getAll().map(toPublicMovie);
    res.json(movies);
  });

  // ─── GET /videos/events (Server-Sent Events Stream) ───────────────────────
  router.get('/videos/events', (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    if (typeof res.flushHeaders === 'function') {
      res.flushHeaders();
    }

    // Push initial movie list snapshot to new client
    const initialMovies = registry.getAll().map(toPublicMovie);
    res.write(`event: init\ndata: ${JSON.stringify(initialMovies)}\n\n`);

    // Broadcast update whenever movie registry changes or progress advances
    const handleChange = () => {
      const updatedMovies = registry.getAll().map(toPublicMovie);
      res.write(`event: update\ndata: ${JSON.stringify(updatedMovies)}\n\n`);
    };

    registry.on('change', handleChange);

    // 15s heartbeat to keep connection alive
    const heartbeat = setInterval(() => {
      res.write(': ping\n\n');
    }, 15000);

    req.on('close', () => {
      clearInterval(heartbeat);
      registry.off('change', handleChange);
    });
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
      case 'partial':
        // Redirect to the HLS master playlist (partial = at least one profile ready)
        res.redirect(302, `/hls/${id}/master.m3u8`);
        break;

      case 'processing':
        res.status(409).json({
          error: 'Movie is still being processed — no quality profile ready yet',
          status: movie.status,
          transcodingProgress: movie.transcodingProgress ?? 0,
          transcodingProfile: movie.transcodingProfile ?? null,
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

  // ─── GET /videos/:id/subtitles ────────────────────────────────────────────────
  router.get('/videos/:id/subtitles', async (req: Request, res: Response) => {
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

    try {
      const tracks = await listExtractedSubtitles(id, hlsDirectory);
      res.json(tracks);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`Failed to list subtitles for ${id}: ${msg}`);
      res.status(500).json({ error: 'Failed to list subtitles' });
    }
  });

  // ─── GET /videos/:id/audio-tracks ──────────────────────────────────────────
  router.get('/videos/:id/audio-tracks', async (req: Request, res: Response) => {
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

    if (movie.audioTracks && movie.audioTracks.length > 0) {
      res.json(movie.audioTracks);
      return;
    }

    // Try reading from HLS metadata.json if available
    try {
      const meta = await readHlsMetadata(id, hlsDirectory);
      if (meta?.audioTracks && meta.audioTracks.length > 0) {
        registry.update(id, { audioTracks: meta.audioTracks });
        res.json(meta.audioTracks);
        return;
      }
    } catch {}

    // Try running ffprobe on the source file if available
    if (movie.sourcePath && movie.sourceAvailable && ffprobePath) {
      try {
        const mediaInfo = await getMediaInfo(movie.sourcePath, ffprobePath);
        if (mediaInfo.audioTracks && mediaInfo.audioTracks.length > 0) {
          registry.update(id, {
            audioTracks: mediaInfo.audioTracks,
            audioCodec: movie.audioCodec || mediaInfo.audioCodec,
          });
          res.json(mediaInfo.audioTracks);
          return;
        }
      } catch (err) {
        logger.warn(`Failed on-demand ffprobe for ${id}: ${err}`);
      }
    }

    // Fallback: return at least 1 track representation so UI can always display audio info
    const fallbackTrack = [
      {
        streamIndex: 0,
        sourceAudioIndex: 0,
        language: 'und',
        label: movie.audioCodec ? `Default (${movie.audioCodec.toUpperCase()})` : 'Default Audio',
        codec: movie.audioCodec || 'aac',
        channels: 2,
      },
    ];
    res.json(fallbackTrack);
  });

  // ─── GET /hls/:id/* — Dynamic & Static HLS file serving ───────────────────
  router.get('/hls/:id/*', async (req: Request, res: Response) => {
    const { id } = req.params;
    const rest = (req.params as Record<string, string>)['0'] ?? '';

    if (!id || !isValidMovieId(id)) {
      res.status(400).json({ error: 'Invalid movie ID' });
      return;
    }

    const movie = registry.get(id);

    // 1. Intercept master.m3u8: if multi-audio is present, dynamically generate master playlist with audio groups
    if (rest === 'master.m3u8') {
      if (movie && movie.audioTracks && movie.audioTracks.length > 1) {
        // Make sure every advertised audio rendition actually exists before the
        // master references it — a missing alternate-audio playlist makes hls.js
        // buffer forever instead of playing.
        const sourcePath = movie.sourcePath;
        if (sourcePath && ffmpegPath) {
          await Promise.all(
            movie.audioTracks.map((track, index) =>
              ensureAudioTrackExtracted(
                id,
                sourcePath,
                index,
                resolveSourceAudioIndex(track, index),
                hlsDirectory,
                ffmpegPath,
              ).catch((err: unknown) => {
                logger.warn(`On-demand audio extraction failed for ${id} audio_${index}: ${err}`);
              }),
            ),
          );
        }
        try {
          const playlistContent = await generateMasterPlaylistContent(id, hlsDirectory, movie);
          res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
          res.setHeader('Cache-Control', 'no-cache, no-store');
          res.send(playlistContent);
          return;
        } catch (err) {
          logger.warn(`Failed to dynamically generate master playlist for ${id}, falling back to static file: ${err}`);
        }
      }
    }

    // 2. Intercept audio tracks: on-demand extraction for audio_<trackIndex>/*
    if (rest.startsWith('audio_')) {
      const match = rest.match(/^audio_(\d+)/);
      const sourcePath = movie?.sourcePath;
      if (match && sourcePath && ffmpegPath) {
        const trackIndex = parseInt(match[1], 10);
        const track = movie?.audioTracks?.[trackIndex];
        try {
          await ensureAudioTrackExtracted(
            id,
            sourcePath,
            trackIndex,
            resolveSourceAudioIndex(track, trackIndex),
            hlsDirectory,
            ffmpegPath,
          );
        } catch (err) {
          logger.error(`Error during on-demand audio extraction for ${id} audio_${trackIndex}:`, err);
        }
      }
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

    // If an audio segment is still being written by FFmpeg, poll briefly for it
    if (rest.startsWith('audio_') && !(await fileExists(filePath))) {
      const start = Date.now();
      while (Date.now() - start < 10000) {
        if (await fileExists(filePath)) break;
        await new Promise((r) => setTimeout(r, 200));
      }
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
    } else if (ext === '.m4s') {
      res.setHeader('Content-Type', 'video/iso.segment');
      // fMP4 segments: can be cached
      res.setHeader('Cache-Control', 'public, max-age=3600');
    } else if (ext === '.mp4') {
      // fMP4 init segment (init.mp4)
      res.setHeader('Content-Type', 'video/mp4');
      res.setHeader('Cache-Control', 'public, max-age=3600');
    } else if (ext === '.vtt') {
      res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
      // Subtitles: short cache
      res.setHeader('Cache-Control', 'public, max-age=300');
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
