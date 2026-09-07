import path from 'path';
import fs from 'fs/promises';
import chokidar, { FSWatcher } from 'chokidar';
import { isSupportedExtension } from './movieScanner.js';
import { MovieRegistry } from './movieRegistry.js';
import { getMediaInfo, selectQualityProfiles, transcodeToHls } from './ffmpegService.js';
import { checkExistingHls, cleanupStaleHls, validateHlsOutput } from './hlsService.js';
import { TranscodingQueue } from './transcodingQueue.js';
import { AppConfig } from '../config/env.js';
import { QUALITY_PROFILES } from '../types/movie.js';
import { generateMovieId, generateMovieTitle } from '../utils/slug.js';
import { logger } from '../utils/logger.js';

/** How long to wait between stability polls (ms) */
const STABILITY_POLL_INTERVAL_MS = 5_000;
/** How many consecutive equal-size readings to consider file stable */
const STABILITY_REQUIRED_PASSES = 2;
/** How many passes to wait before giving up */
const STABILITY_MAX_PASSES = 24; // 2 minutes

/**
 * Watches the movie directory for new, removed, and changed files.
 * Orchestrates the full pipeline: detect → validate → probe → register → transcode.
 */
export class MovieWatcher {
  private watcher: FSWatcher | null = null;
  private pendingStabilityChecks = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly registry: MovieRegistry,
    private readonly queue: TranscodingQueue,
    private readonly config: AppConfig,
  ) {}

  start(): void {
    const { movieDirectory } = this.config;

    logger.info(`Movie watcher started on: ${movieDirectory}`);

    this.watcher = chokidar.watch(movieDirectory, {
      // Watch only the top-level directory (non-recursive)
      depth: 0,
      // Wait for file to not change for 2 seconds before emitting 'add'
      awaitWriteFinish: {
        stabilityThreshold: 2000,
        pollInterval: 500,
      },
      ignoreInitial: true,
      persistent: true,
    });

    this.watcher.on('add', (filePath) => {
      this.onFileAdded(filePath).catch((err) => {
        logger.error(`Error handling added file: ${filePath}`, err);
      });
    });

    this.watcher.on('unlink', (filePath) => {
      this.onFileRemoved(filePath).catch((err) => {
        logger.error(`Error handling removed file: ${filePath}`, err);
      });
    });

    this.watcher.on('change', (filePath) => {
      this.onFileChanged(filePath).catch((err) => {
        logger.error(`Error handling changed file: ${filePath}`, err);
      });
    });

    this.watcher.on('error', (err) => {
      logger.error('File watcher error', err);
    });
  }

  stop(): void {
    for (const timeout of this.pendingStabilityChecks.values()) {
      clearTimeout(timeout);
    }
    this.pendingStabilityChecks.clear();

    if (this.watcher) {
      this.watcher.close().catch(() => {});
      this.watcher = null;
      logger.info('Movie watcher stopped');
    }
  }

  private async onFileAdded(filePath: string): Promise<void> {
    const filename = path.basename(filePath);
    const ext = path.extname(filename).toLowerCase();

    if (!isSupportedExtension(ext)) {
      return; // silently ignore unsupported files
    }

    logger.info(`New movie detected: ${filename}`);

    // Additional stability check on top of chokidar's awaitWriteFinish
    await this.waitForStableFile(filePath);

    await this.processNewMovie(filePath);
  }

  private async onFileRemoved(filePath: string): Promise<void> {
    const filename = path.basename(filePath);
    const ext = path.extname(filename).toLowerCase();

    if (!isSupportedExtension(ext)) return;

    const movieId = generateMovieId(filename);
    logger.info(`Movie removed: ${filename} (${movieId})`);

    this.registry.remove(movieId);
    await cleanupStaleHls(movieId, this.config.hlsDirectory);
  }

  private async onFileChanged(filePath: string): Promise<void> {
    const filename = path.basename(filePath);
    const ext = path.extname(filename).toLowerCase();

    if (!isSupportedExtension(ext)) return;

    const movieId = generateMovieId(filename);
    const existing = this.registry.get(movieId);

    if (!existing) {
      // Treat as a new file
      await this.onFileAdded(filePath);
      return;
    }

    logger.info(`Movie source changed, will re-transcode: ${filename}`);

    // Mark stale
    this.registry.update(movieId, { status: 'discovered', error: undefined });

    // Clean old HLS
    await cleanupStaleHls(movieId, this.config.hlsDirectory);

    // Wait for stability, then re-queue
    await this.waitForStableFile(filePath);
    await this.queueTranscoding(movieId, filePath);
  }

  /**
   * Polls file size until it is stable across two consecutive checks.
   * This is a safety net for large files still being copied.
   */
  private async waitForStableFile(filePath: string): Promise<void> {
    let previousSize = -1;
    let stableCount = 0;

    for (let pass = 0; pass < STABILITY_MAX_PASSES; pass++) {
      await delay(STABILITY_POLL_INTERVAL_MS);

      try {
        const stats = await fs.stat(filePath);
        if (stats.size === previousSize) {
          stableCount++;
          if (stableCount >= STABILITY_REQUIRED_PASSES) {
            logger.info(`File stable: ${path.basename(filePath)} (${stats.size} bytes)`);
            return;
          }
        } else {
          stableCount = 0;
          previousSize = stats.size;
        }
      } catch {
        // File may have been removed — abort
        return;
      }
    }

    logger.warn(`File stability timeout for: ${path.basename(filePath)} — proceeding anyway`);
  }

  /**
   * Processes a newly discovered stable file end-to-end.
   */
  async processNewMovie(filePath: string): Promise<void> {
    const filename = path.basename(filePath);
    const ext = path.extname(filename).toLowerCase();
    const movieId = generateMovieId(filename);

    // Avoid re-processing an already registered movie
    if (this.registry.has(movieId)) {
      const existing = this.registry.get(movieId)!;
      if (existing.status === 'ready' || existing.status === 'processing' || existing.status === 'queued') {
        logger.info(`Movie already registered (${existing.status}): ${movieId}`);
        return;
      }
    }

    let stats: Awaited<ReturnType<typeof fs.stat>>;
    try {
      stats = await fs.stat(filePath);
    } catch {
      logger.error(`Cannot stat file (may have been removed): ${filePath}`);
      return;
    }

    // Register with 'discovered' status initially
    const now = new Date().toISOString();
    this.registry.add({
      id: movieId,
      title: generateMovieTitle(filename),
      filename,
      sourcePath: filePath,
      extension: ext,
      sizeBytes: stats.size,
      status: 'discovered',
      createdAt: now,
      updatedAt: now,
    });

    // Run ffprobe to get metadata
    try {
      const mediaInfo = await getMediaInfo(filePath, this.config.ffprobePath);
      this.registry.update(movieId, {
        durationSeconds: mediaInfo.durationSeconds,
        width: mediaInfo.width,
        height: mediaInfo.height,
        videoCodec: mediaInfo.videoCodec,
        audioCodec: mediaInfo.audioCodec,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`ffprobe failed for ${filename}: ${message}`);
      this.registry.update(movieId, { status: 'failed', error: 'Media probe failed: invalid or corrupt file' });
      return;
    }

    if (this.config.autoTranscode) {
      await this.queueTranscoding(movieId, filePath);
    }
  }

  private async queueTranscoding(movieId: string, filePath: string): Promise<void> {
    if (this.queue.isPending(movieId)) {
      logger.info(`Transcoding already pending for: ${movieId}`);
      return;
    }

    this.registry.update(movieId, { status: 'queued' });
    logger.info(`Queued transcoding: ${movieId}`);

    this.queue.enqueue(movieId, async () => {
      const movie = this.registry.get(movieId);
      if (!movie) {
        logger.warn(`Movie disappeared from registry before transcoding: ${movieId}`);
        return;
      }

      this.registry.update(movieId, { status: 'processing' });

      const profiles = selectQualityProfiles(
        movie.height ?? 0,
        {
          transcode480p: this.config.transcode480p,
          transcode720p: this.config.transcode720p,
          transcode1080p: this.config.transcode1080p,
        },
        QUALITY_PROFILES,
      );

      if (profiles.length === 0) {
        logger.warn(`No suitable quality profiles for ${movieId} (height: ${movie.height})`);
        this.registry.update(movieId, {
          status: 'failed',
          error: 'No suitable quality profiles determined for this source resolution',
        });
        return;
      }

      try {
        const stats = await fs.stat(filePath);
        await transcodeToHls({
          movieId,
          inputPath: filePath,
          hlsDirectory: this.config.hlsDirectory,
          segmentDuration: this.config.hlsSegmentDuration,
          profiles,
          sourceInfo: {
            durationSeconds: movie.durationSeconds ?? 0,
            width: movie.width ?? 0,
            height: movie.height ?? 0,
            videoCodec: movie.videoCodec ?? '',
            audioCodec: movie.audioCodec ?? '',
            hasVideo: true,
            hasAudio: !!movie.audioCodec,
          },
          ffmpegPath: this.config.ffmpegPath,
          sourceSizeBytes: stats.size,
          sourceModifiedTime: stats.mtimeMs,
          onProgress: (percent, profileName) => {
            this.registry.update(movieId, {
              transcodingProgress: percent,
              transcodingProfile: profileName,
            });
            logger.info(`Transcoding ${movieId} [${profileName}]: ${percent}%`);
          },
        });

        // Validate the output
        const valid = await validateHlsOutput(movieId, this.config.hlsDirectory);
        if (!valid) {
          throw new Error('HLS output validation failed: files missing after transcoding');
        }

        this.registry.update(movieId, {
          status: 'ready',
          error: undefined,
          transcodingProgress: undefined,
          transcodingProfile: undefined,
        });
        logger.info(`FFmpeg completed: ${movieId} — status: ready`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error(`FFmpeg failed: ${movieId} — ${message}`);
        this.registry.update(movieId, {
          status: 'failed',
          error: 'Transcoding failed',
          transcodingProgress: undefined,
          transcodingProfile: undefined,
        });
      }
    });
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
