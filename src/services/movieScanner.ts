import fs from 'fs/promises';
import path from 'path';
import { SUPPORTED_EXTENSIONS } from '../types/movie.js';
import { logger } from '../utils/logger.js';

export interface ScannedFile {
  filePath: string;
  filename: string;
  extension: string;
  sizeBytes: number;
  modifiedTime: number;
}

/**
 * Scans a directory for supported movie files.
 * The scan is non-recursive (flat directory only).
 * Returns an array of ScannedFile objects for each supported video file found.
 */
export async function scanDirectory(directory: string): Promise<ScannedFile[]> {
  const results: ScannedFile[] = [];

  let names: string[];
  try {
    names = await fs.readdir(directory);
  } catch (err) {
    logger.error(`Failed to read movie directory: ${directory}`, err);
    return results;
  }

  for (const name of names) {
    const filePath = path.join(directory, name);

    let stats: Awaited<ReturnType<typeof fs.stat>>;
    try {
      stats = await fs.stat(filePath);
    } catch (err) {
      logger.warn(`Could not stat file: ${filePath}`, err);
      continue;
    }

    // Only process regular files, not subdirectories
    if (!stats.isFile()) continue;

    const ext = path.extname(name).toLowerCase();
    if (!SUPPORTED_EXTENSIONS.has(ext)) continue;

    results.push({
      filePath,
      filename: name,
      extension: ext,
      sizeBytes: stats.size,
      modifiedTime: stats.mtimeMs,
    });
  }

  logger.info(`Movie scanner found ${results.length} supported file(s) in ${directory}`);
  return results;
}

/**
 * Returns true if the given file extension is a supported video format.
 */
export function isSupportedExtension(ext: string): boolean {
  return SUPPORTED_EXTENSIONS.has(ext.toLowerCase());
}
