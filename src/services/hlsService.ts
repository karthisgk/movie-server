import fs from 'fs/promises';
import path from 'path';
import { HlsMetadata } from '../types/movie.js';
import { fileExists, readJsonFile, safeRemoveDir } from '../utils/filesystem.js';
import { logger } from '../utils/logger.js';

export type HlsStatus = 'ready' | 'stale' | 'missing';

/**
 * Checks whether valid HLS output already exists for a given movie.
 *
 * Returns:
 *  - 'ready'  — master.m3u8 exists and source file matches metadata
 *  - 'stale'  — HLS exists but source file changed (different size or mtime)
 *  - 'missing' — no HLS output found
 */
export async function checkExistingHls(
  movieId: string,
  hlsDirectory: string,
  sourcePath: string,
  sourceSizeBytes: number,
  sourceModifiedTime: number,
): Promise<HlsStatus> {
  const hlsDir = path.join(hlsDirectory, movieId);
  const masterPlaylist = path.join(hlsDir, 'master.m3u8');
  const metadataFile = path.join(hlsDir, 'metadata.json');

  if (!(await fileExists(masterPlaylist))) {
    return 'missing';
  }

  // Read metadata to check staleness
  const metadata = await readJsonFile<HlsMetadata>(metadataFile);

  if (!metadata) {
    // master.m3u8 exists but no metadata — treat as stale
    logger.warn(`HLS for ${movieId}: master.m3u8 found but metadata.json missing — marking stale`);
    return 'stale';
  }

  // Compare source stats
  if (
    metadata.sourceSizeBytes !== sourceSizeBytes ||
    metadata.sourceModifiedTime !== sourceModifiedTime
  ) {
    logger.info(
      `HLS for ${movieId} is stale (source changed: ` +
        `size ${metadata.sourceSizeBytes} → ${sourceSizeBytes}, ` +
        `mtime ${metadata.sourceModifiedTime} → ${sourceModifiedTime})`,
    );
    return 'stale';
  }

  logger.info(`HLS for ${movieId} is valid and up to date`);
  return 'ready';
}

/**
 * Validates that the required HLS output files actually exist.
 * Reads master.m3u8 and verifies referenced sub-playlists are present.
 */
export async function validateHlsOutput(movieId: string, hlsDirectory: string): Promise<boolean> {
  const hlsDir = path.join(hlsDirectory, movieId);
  const masterPath = path.join(hlsDir, 'master.m3u8');

  if (!(await fileExists(masterPath))) {
    logger.warn(`validateHlsOutput: master.m3u8 missing for ${movieId}`);
    return false;
  }

  try {
    const masterContent = await fs.readFile(masterPath, 'utf-8');
    const playlistPaths = masterContent
      .split('\n')
      .filter((line) => line.trim() && !line.startsWith('#'))
      .map((line) => line.trim());

    for (const relPath of playlistPaths) {
      const absPath = path.join(hlsDir, relPath);
      if (!(await fileExists(absPath))) {
        logger.warn(`validateHlsOutput: referenced playlist missing: ${absPath}`);
        return false;
      }
    }

    return true;
  } catch (err) {
    logger.error(`validateHlsOutput: error reading master.m3u8 for ${movieId}`, err);
    return false;
  }
}

/**
 * Removes the HLS directory for a movie.
 */
export async function cleanupStaleHls(movieId: string, hlsDirectory: string): Promise<void> {
  const hlsDir = path.join(hlsDirectory, movieId);
  logger.info(`Cleaning up stale/orphaned HLS for: ${movieId}`);
  await safeRemoveDir(hlsDir);
}

/**
 * Removes any leftover `.tmp-<movieId>` directories (from crashed transcodes).
 */
export async function cleanupTempDirs(hlsDirectory: string): Promise<void> {
  try {
    const entries = await fs.readdir(hlsDirectory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name.startsWith('.tmp-')) {
        const tmpPath = path.join(hlsDirectory, entry.name);
        logger.info(`Removing leftover temp HLS directory: ${entry.name}`);
        await safeRemoveDir(tmpPath);
      }
    }
  } catch {
    // If directory doesn't exist yet, nothing to clean
  }
}
