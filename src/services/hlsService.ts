import fs from 'fs/promises';
import path from 'path';
import { HlsMetadata } from '../types/movie.js';
import { fileExists, readJsonFile, safeRemoveDir } from '../utils/filesystem.js';
import { logger } from '../utils/logger.js';

export type HlsStatus = 'ready' | 'partial' | 'stale' | 'missing';

/**
 * Checks whether valid HLS output already exists for a given movie.
 *
 * Returns:
 *  - 'ready'   — master.m3u8 exists, all expected profiles present, source matches metadata
 *  - 'partial' — HLS exists, source matches, but some profiles are missing (crash recovery)
 *  - 'stale'   — HLS exists but source file changed (different size)
 *  - 'missing' — no HLS output found
 */
export async function checkExistingHls(
  movieId: string,
  hlsDirectory: string,
  sourcePath: string,
  sourceSizeBytes: number,
  sourceModifiedTime: number,
  expectedProfiles?: string[],
): Promise<HlsStatus> {
  const hlsDir = path.join(hlsDirectory, movieId);
  const masterPlaylist = path.join(hlsDir, 'master.m3u8');
  const metadataFile = path.join(hlsDir, 'metadata.json');

  if (!(await fileExists(masterPlaylist))) {
    // Check if any profile subdirs exist at all (crash before first master.m3u8 write)
    if (expectedProfiles) {
      for (const p of expectedProfiles) {
        if (await fileExists(path.join(hlsDir, p, 'playlist.m3u8'))) {
          // At least one profile is done but master.m3u8 not yet written
          logger.info(`HLS for ${movieId}: partial output detected (no master.m3u8 yet)`);
          return 'partial';
        }
      }
    }
    return 'missing';
  }

  // Read metadata to check staleness
  const metadata = await readJsonFile<HlsMetadata>(metadataFile);

  if (!metadata) {
    // master.m3u8 exists but no metadata — treat as stale
    logger.warn(`HLS for ${movieId}: master.m3u8 found but metadata.json missing — marking stale`);
    return 'stale';
  }

  // Compare source size only — mtime is unreliable (players like VLC update it on read)
  if (metadata.sourceSizeBytes !== sourceSizeBytes) {
    logger.info(
      `HLS for ${movieId} is stale (source size changed: ` +
        `${metadata.sourceSizeBytes} → ${sourceSizeBytes})`,
    );
    return 'stale';
  }

  // Source matches — check if all expected profiles are present
  if (expectedProfiles && expectedProfiles.length > 0) {
    const missingProfiles: string[] = [];
    for (const p of expectedProfiles) {
      if (!(await fileExists(path.join(hlsDir, p, 'playlist.m3u8')))) {
        missingProfiles.push(p);
      }
    }
    if (missingProfiles.length > 0) {
      logger.info(`HLS for ${movieId} is partial — missing profiles: ${missingProfiles.join(', ')}`);
      return 'partial';
    }
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
 * Reads and returns the metadata.json for a given movie's HLS output.
 * Returns null if the file does not exist or cannot be parsed.
 */
export async function readHlsMetadata(
  movieId: string,
  hlsDirectory: string,
): Promise<import('../types/movie.js').HlsMetadata | null> {
  const metadataFile = path.join(hlsDirectory, movieId, 'metadata.json');
  return readJsonFile<import('../types/movie.js').HlsMetadata>(metadataFile);
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
