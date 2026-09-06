import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { MovieRegistry } from '../src/services/movieRegistry.js';
import { TranscodingQueue } from '../src/services/transcodingQueue.js';
import { createHealthRouter } from '../src/routes/healthRoutes.js';
import { createVideoRouter } from '../src/routes/videoRoutes.js';
import { errorHandler, notFoundHandler } from '../src/middleware/errorHandler.js';
import { Movie } from '../src/types/movie.js';
import os from 'os';
import path from 'path';

// Build a test Express app (no FFmpeg, no real filesystem)
function buildTestApp(registry: MovieRegistry, queue: TranscodingQueue) {
  const app = express();
  app.use(express.json());

  // Use a temp dir as a fake HLS root
  const fakeHlsDir = os.tmpdir();

  app.use('/', createHealthRouter(registry, queue));
  app.use('/', createVideoRouter(registry, fakeHlsDir));
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

function makeMovie(overrides: Partial<Movie> = {}): Movie {
  const now = new Date().toISOString();
  return {
    id: 'test-movie-2024',
    title: 'Test Movie (2024)',
    filename: 'Test Movie (2024).mkv',
    sourcePath: 'C:\\Movies\\Test Movie (2024).mkv',
    extension: '.mkv',
    sizeBytes: 1_000_000_000,
    status: 'ready',
    durationSeconds: 7200,
    width: 1920,
    height: 1080,
    videoCodec: 'h264',
    audioCodec: 'aac',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('GET /health', () => {
  it('returns 200 with status ok', async () => {
    const registry = new MovieRegistry();
    const queue = new TranscodingQueue(1);
    const app = buildTestApp(registry, queue);

    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(typeof res.body.movies).toBe('number');
    expect(typeof res.body.transcoding).toBe('number');
    expect(typeof res.body.queued).toBe('number');
  });

  it('reflects movie count', async () => {
    const registry = new MovieRegistry();
    const queue = new TranscodingQueue(1);
    registry.add(makeMovie());

    const app = buildTestApp(registry, queue);
    const res = await request(app).get('/health');

    expect(res.body.movies).toBe(1);
  });
});

describe('GET /videos', () => {
  it('returns empty array when no movies', async () => {
    const registry = new MovieRegistry();
    const queue = new TranscodingQueue(1);
    const app = buildTestApp(registry, queue);

    const res = await request(app).get('/videos');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('returns movie list with public fields', async () => {
    const registry = new MovieRegistry();
    const queue = new TranscodingQueue(1);
    registry.add(makeMovie());

    const app = buildTestApp(registry, queue);
    const res = await request(app).get('/videos');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);

    const movie = res.body[0];
    expect(movie.id).toBe('test-movie-2024');
    expect(movie.title).toBe('Test Movie (2024)');
    expect(movie.playUrl).toBe('/videos/test-movie-2024/play');

    // Must NOT expose internal filesystem path
    expect(movie.sourcePath).toBeUndefined();
  });
});

describe('GET /videos/:id', () => {
  it('returns 200 with movie details for valid ID', async () => {
    const registry = new MovieRegistry();
    const queue = new TranscodingQueue(1);
    registry.add(makeMovie());

    const app = buildTestApp(registry, queue);
    const res = await request(app).get('/videos/test-movie-2024');

    expect(res.status).toBe(200);
    expect(res.body.id).toBe('test-movie-2024');
    expect(res.body.title).toBe('Test Movie (2024)');
  });

  it('returns 404 for unknown movie', async () => {
    const registry = new MovieRegistry();
    const queue = new TranscodingQueue(1);
    const app = buildTestApp(registry, queue);

    const res = await request(app).get('/videos/nonexistent-movie-9999');

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Movie not found');
  });

  it('returns 400 for invalid ID with path traversal', async () => {
    const registry = new MovieRegistry();
    const queue = new TranscodingQueue(1);
    const app = buildTestApp(registry, queue);

    const res = await request(app).get('/videos/..%2Fetc%2Fpasswd');

    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});

describe('GET /videos/:id/play', () => {
  it('redirects to master.m3u8 when movie is ready', async () => {
    const registry = new MovieRegistry();
    const queue = new TranscodingQueue(1);
    registry.add(makeMovie({ status: 'ready' }));

    const app = buildTestApp(registry, queue);
    const res = await request(app).get('/videos/test-movie-2024/play').redirects(0);

    expect(res.status).toBe(302);
    expect(res.headers['location']).toBe('/hls/test-movie-2024/master.m3u8');
  });

  it('returns 409 when movie is processing', async () => {
    const registry = new MovieRegistry();
    const queue = new TranscodingQueue(1);
    registry.add(makeMovie({ status: 'processing' }));

    const app = buildTestApp(registry, queue);
    const res = await request(app).get('/videos/test-movie-2024/play');

    expect(res.status).toBe(409);
    expect(res.body.status).toBe('processing');
  });

  it('returns 409 when movie is queued', async () => {
    const registry = new MovieRegistry();
    const queue = new TranscodingQueue(1);
    registry.add(makeMovie({ status: 'queued' }));

    const app = buildTestApp(registry, queue);
    const res = await request(app).get('/videos/test-movie-2024/play');

    expect(res.status).toBe(409);
    expect(res.body.status).toBe('queued');
  });

  it('returns 500 when movie has failed', async () => {
    const registry = new MovieRegistry();
    const queue = new TranscodingQueue(1);
    registry.add(makeMovie({ status: 'failed', error: 'Transcoding failed' }));

    const app = buildTestApp(registry, queue);
    const res = await request(app).get('/videos/test-movie-2024/play');

    expect(res.status).toBe(500);
  });

  it('returns 404 when movie does not exist', async () => {
    const registry = new MovieRegistry();
    const queue = new TranscodingQueue(1);
    const app = buildTestApp(registry, queue);

    const res = await request(app).get('/videos/does-not-exist-0000/play');

    expect(res.status).toBe(404);
  });
});

describe('404 handler', () => {
  it('returns 404 for unknown routes', async () => {
    const registry = new MovieRegistry();
    const queue = new TranscodingQueue(1);
    const app = buildTestApp(registry, queue);

    const res = await request(app).get('/completely/unknown/route');

    expect(res.status).toBe(404);
  });
});
