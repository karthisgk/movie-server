import fs from 'fs/promises';
import type { Stats } from 'fs';
import path from 'path';
import { logger } from './logger.js';

/**
 * Ensures a directory exists, creating it (and any parents) if necessary.
 */
export async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

/**
 * Returns true if a file or directory exists at the given path.
 */
export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Returns fs.Stats for a path, or null if it does not exist.
 */
export async function getFileStats(filePath: string): Promise<Stats | null> {
  try {
    return await fs.stat(filePath);
  } catch {
    return null;
  }
}

/**
 * Safely removes a directory and all its contents.
 * Logs a warning if removal fails, but does not throw.
 */
export async function safeRemoveDir(dirPath: string): Promise<void> {
  try {
    await fs.rm(dirPath, { recursive: true, force: true });
  } catch (err) {
    logger.warn(`Failed to remove directory: ${dirPath}`, err);
  }
}

/**
 * Safely moves (renames) a directory from src to dest.
 * Falls back to copy+delete if rename fails across drives.
 */
export async function moveDir(src: string, dest: string): Promise<void> {
  try {
    await fs.rename(src, dest);
  } catch {
    // Cross-device rename may fail on Windows — copy then delete
    await copyDir(src, dest);
    await safeRemoveDir(src);
  }
}

async function copyDir(src: string, dest: string): Promise<void> {
  await ensureDir(dest);
  const entries = await fs.readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

/**
 * Reads a JSON file and returns the parsed object, or null on failure.
 */
export async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

/**
 * Writes an object as formatted JSON to a file.
 */
export async function writeJsonFile(filePath: string, data: unknown): Promise<void> {
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

/**
 * Resolves a path and verifies it is within an allowed root directory.
 * Throws if the resolved path escapes the root (path traversal protection).
 */
export function resolveAndVerifyPath(root: string, ...segments: string[]): string {
  const resolved = path.resolve(root, ...segments);
  const normalizedRoot = path.resolve(root);

  if (!resolved.startsWith(normalizedRoot + path.sep) && resolved !== normalizedRoot) {
    throw new Error(`Path traversal detected: ${resolved} is outside ${normalizedRoot}`);
  }

  return resolved;
}
