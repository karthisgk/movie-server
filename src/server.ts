import express from 'express';
import cors from 'cors';
import { config } from './config/env.js';
import { logger } from './utils/logger.js';
import { ensureDir } from './utils/filesystem.js';
import { validateFfmpeg, validateFfprobe, getMediaInfo, selectQualityProfiles, transcodeToHls } from './services/ffmpegService.js';
import { scanDirectory } from './services/movieScanner.js';
import { MovieRegistry } from './services/movieRegistry.js';
import { TranscodingQueue } from './services/transcodingQueue.js';
import { MovieWatcher } from './services/movieWatcher.js';
import { checkExistingHls, cleanupStaleHls, cleanupTempDirs, validateHlsOutput } from './services/hlsService.js';
import { createHealthRouter } from './routes/healthRoutes.js';
import { createVideoRouter } from './routes/videoRoutes.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { generateMovieId, generateMovieTitle } from './utils/slug.js';
import { QUALITY_PROFILES } from './types/movie.js';
import fs from 'fs/promises';
import http from 'http';

// ─── Bootstrap ───────────────────────────────────────────────────────────────

async function bootstrap(): Promise<void> {
  logger.info('═══════════════════════════════════════════════');
  logger.info('  Home LAN Movie Streaming Server');
  logger.info('═══════════════════════════════════════════════');

  // Step 1: Validate FFmpeg + FFprobe
  logger.info('Validating FFmpeg...');
  try {
    await validateFfmpeg(config.ffmpegPath);
    logger.info(`FFmpeg OK: ${config.ffmpegPath}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`FFmpeg validation failed: ${msg}`);
    logger.error('Please install FFmpeg and set FFMPEG_PATH in your .env file.');
    process.exit(1);
  }

  logger.info('Validating FFprobe...');
  try {
    await validateFfprobe(config.ffprobePath);
    logger.info(`FFprobe OK: ${config.ffprobePath}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`FFprobe validation failed: ${msg}`);
    logger.error('Please install FFprobe and set FFPROBE_PATH in your .env file.');
    process.exit(1);
  }

  // Step 2: Ensure directories exist
  logger.info(`Movie directory: ${config.movieDirectory}`);
  try {
    await ensureDir(config.movieDirectory);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`Cannot create/access movie directory "${config.movieDirectory}": ${msg}`);
    process.exit(1);
  }

  logger.info(`HLS directory: ${config.hlsDirectory}`);
  await ensureDir(config.hlsDirectory);

  // Step 3: Clean up leftover temp HLS directories from crashed runs
  await cleanupTempDirs(config.hlsDirectory);

  // Step 4: Create registry and queue
  const registry = new MovieRegistry();
  const queue = new TranscodingQueue(config.maxConcurrentTranscodes);

  // Step 5: Scan existing movies
  logger.info('Scanning movie directory...');
  const scannedFiles = await scanDirectory(config.movieDirectory);
  logger.info(`Found ${scannedFiles.length} movie file(s)`);

  // Step 6: Process each scanned file
  for (const scanned of scannedFiles) {
    const movieId = generateMovieId(scanned.filename);
    const now = new Date().toISOString();

    // Register with 'discovered' status
    registry.add({
      id: movieId,
      title: generateMovieTitle(scanned.filename),
      filename: scanned.filename,
      sourcePath: scanned.filePath,
      extension: scanned.extension,
      sizeBytes: scanned.sizeBytes,
      status: 'discovered',
      createdAt: now,
      updatedAt: now,
    });

    // Run ffprobe
    try {
      const mediaInfo = await getMediaInfo(scanned.filePath, config.ffprobePath);
      registry.update(movieId, {
        durationSeconds: mediaInfo.durationSeconds,
        width: mediaInfo.width,
        height: mediaInfo.height,
        videoCodec: mediaInfo.videoCodec,
        audioCodec: mediaInfo.audioCodec,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`ffprobe failed for ${scanned.filename}: ${msg}`);
      registry.update(movieId, { status: 'failed', error: 'Media probe failed: invalid or corrupt file' });
      continue;
    }

    // Check existing HLS
    const movie = registry.get(movieId)!;
    const hlsStatus = await checkExistingHls(
      movieId,
      config.hlsDirectory,
      scanned.filePath,
      scanned.sizeBytes,
      scanned.modifiedTime,
    );

    if (hlsStatus === 'ready') {
      const valid = await validateHlsOutput(movieId, config.hlsDirectory);
      if (valid) {
        registry.update(movieId, { status: 'ready' });
        logger.info(`Movie ready (existing HLS): ${scanned.filename}`);
        continue;
      } else {
        logger.warn(`HLS for ${movieId} failed validation — will re-transcode`);
        await cleanupStaleHls(movieId, config.hlsDirectory);
      }
    } else if (hlsStatus === 'stale') {
      logger.info(`Stale HLS for ${movieId} — will re-transcode`);
      await cleanupStaleHls(movieId, config.hlsDirectory);
    }

    // Queue transcoding if AUTO_TRANSCODE is on
    if (config.autoTranscode) {
      registry.update(movieId, { status: 'queued' });
      logger.info(`Queued transcoding: ${movieId}`);

      const filePath = scanned.filePath;

      queue.enqueue(movieId, async () => {
        const m = registry.get(movieId);
        if (!m) return;

        registry.update(movieId, { status: 'processing' });

        const profiles = selectQualityProfiles(
          m.height ?? 0,
          {
            transcode480p: config.transcode480p,
            transcode720p: config.transcode720p,
            transcode1080p: config.transcode1080p,
          },
          QUALITY_PROFILES,
        );

        if (profiles.length === 0) {
          registry.update(movieId, {
            status: 'failed',
            error: 'No suitable quality profiles for this resolution',
          });
          return;
        }

        try {
          const stats = await fs.stat(filePath);
          await transcodeToHls({
            movieId,
            inputPath: filePath,
            hlsDirectory: config.hlsDirectory,
            segmentDuration: config.hlsSegmentDuration,
            profiles,
            sourceInfo: {
              durationSeconds: m.durationSeconds ?? 0,
              width: m.width ?? 0,
              height: m.height ?? 0,
              videoCodec: m.videoCodec ?? '',
              audioCodec: m.audioCodec ?? '',
              hasVideo: true,
              hasAudio: !!m.audioCodec,
            },
            ffmpegPath: config.ffmpegPath,
            sourceSizeBytes: stats.size,
            sourceModifiedTime: stats.mtimeMs,
            onProgress: (percent, profileName) => {
              registry.update(movieId, {
                transcodingProgress: percent,
                transcodingProfile: profileName,
              });
              logger.info(`Transcoding ${movieId} [${profileName}]: ${percent}%`);
            },
          });

          const valid = await validateHlsOutput(movieId, config.hlsDirectory);
          if (!valid) throw new Error('HLS output validation failed');

          registry.update(movieId, {
            status: 'ready',
            error: undefined,
            transcodingProgress: undefined,
            transcodingProfile: undefined,
          });
          logger.info(`FFmpeg completed: ${movieId}`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          logger.error(`FFmpeg failed: ${movieId} — ${msg}`);
          registry.update(movieId, {
            status: 'failed',
            error: 'Transcoding failed',
            transcodingProgress: undefined,
            transcodingProfile: undefined,
          });
        }
      });
    }
  }

  // Clean up HLS directories for movies that no longer exist
  try {
    const hlsEntries = await fs.readdir(config.hlsDirectory, { withFileTypes: true });
    for (const entry of hlsEntries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith('.tmp-')) continue;

      // If no movie in registry has this ID, it's orphaned
      if (!registry.has(entry.name)) {
        logger.info(`Removing orphaned HLS directory: ${entry.name}`);
        await cleanupStaleHls(entry.name, config.hlsDirectory);
      }
    }
  } catch {
    // hlsDirectory may have just been created — nothing to clean
  }

  // Step 7: Start file watcher
  const watcher = new MovieWatcher(registry, queue, config);
  watcher.start();

  // Step 8: Set up Express
  const app = express();

  app.use(cors());
  app.use(express.json());

  // Disable X-Powered-By header
  app.disable('x-powered-by');

  // Routes
  app.use('/', createHealthRouter(registry, queue));
  app.use('/', createVideoRouter(registry, config.hlsDirectory));

  // 404 + error handlers (must be last)
  app.use(notFoundHandler);
  app.use(errorHandler);

  // Step 9: Start HTTP server
  const server = http.createServer(app);

  await new Promise<void>((resolve) => {
    server.listen(config.port, config.host, () => {
      logger.info(`Server listening on http://${config.host}:${config.port}`);
      logger.info(`Local access:   http://localhost:${config.port}/health`);
      logger.info(`Run 'ipconfig' to find your LAN IP for remote device access.`);
      resolve();
    });
  });

  // ─── Graceful Shutdown ──────────────────────────────────────────────────────
  const shutdown = async (signal: string): Promise<void> => {
    logger.info(`Received ${signal} — shutting down gracefully...`);

    // Stop accepting new requests
    server.close(() => {
      logger.info('HTTP server closed');
    });

    // Stop watcher
    watcher.stop();

    // Drain queue (no new jobs)
    queue.drain();

    // Give running transcodes a moment to exit cleanly
    await delay(1000);

    logger.info('Shutdown complete');
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // Prevent uncaught errors from crashing the server
  process.on('uncaughtException', (err) => {
    logger.error('Uncaught exception', err);
  });

  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled promise rejection', reason);
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

bootstrap().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
