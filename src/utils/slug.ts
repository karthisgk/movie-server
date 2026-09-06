import path from 'path';

/**
 * Generates a deterministic, filesystem-safe movie ID from a filename.
 *
 * Examples:
 *   "Interstellar (2014).mkv"     → "interstellar-2014"
 *   "The Dark Knight (2008).mp4"  → "the-dark-knight-2008"
 */
export function generateMovieId(filename: string): string {
  // Remove extension
  const withoutExt = filename.slice(0, filename.lastIndexOf('.')) || filename;

  return withoutExt
    .toLowerCase()
    // Strip apostrophes/single-quotes so "It's" → "its" not "it-s"
    .replace(/['''`]/g, '')
    // Replace any character that is not a letter, number, or space with a hyphen
    .replace(/[^a-z0-9 ]/g, '-')
    // Replace one or more spaces/hyphens with a single hyphen
    .replace(/[\s-]+/g, '-')
    // Remove leading/trailing hyphens
    .replace(/^-+|-+$/g, '');
}

/**
 * Derives a human-readable title from a filename.
 *
 * Example: "Interstellar (2014).mkv" → "Interstellar (2014)"
 */
export function generateMovieTitle(filename: string): string {
  const ext = path.extname(filename);
  return filename.slice(0, filename.length - ext.length).trim();
}

/**
 * Validates that a movie ID is safe to use as a filesystem path component.
 * Rejects IDs containing '..', '/', or '\'.
 */
export function isValidMovieId(id: string): boolean {
  if (!id || typeof id !== 'string') return false;
  if (id.includes('..')) return false;
  if (id.includes('/')) return false;
  if (id.includes('\\')) return false;
  if (id.includes('\0')) return false;
  // Must be non-empty and consist of safe characters
  return /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/.test(id);
}
