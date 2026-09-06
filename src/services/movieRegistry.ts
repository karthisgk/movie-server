import { Movie } from '../types/movie.js';
import { logger } from '../utils/logger.js';

/**
 * In-memory registry of all discovered movies.
 * The filesystem is the source of truth — this is rebuilt on every restart.
 */
export class MovieRegistry {
  private movies = new Map<string, Movie>();

  add(movie: Movie): void {
    this.movies.set(movie.id, movie);
    logger.info(`Registry: added movie "${movie.filename}" (${movie.id})`);
  }

  update(id: string, updates: Partial<Movie>): Movie | null {
    const existing = this.movies.get(id);
    if (!existing) return null;

    const updated: Movie = {
      ...existing,
      ...updates,
      id: existing.id, // ID is immutable
      updatedAt: new Date().toISOString(),
    };
    this.movies.set(id, updated);
    return updated;
  }

  remove(id: string): boolean {
    const existed = this.movies.has(id);
    if (existed) {
      const movie = this.movies.get(id);
      this.movies.delete(id);
      logger.info(`Registry: removed movie "${movie?.filename}" (${id})`);
    }
    return existed;
  }

  get(id: string): Movie | undefined {
    return this.movies.get(id);
  }

  getAll(): Movie[] {
    return Array.from(this.movies.values());
  }

  has(id: string): boolean {
    return this.movies.has(id);
  }

  findBySourcePath(sourcePath: string): Movie | undefined {
    for (const movie of this.movies.values()) {
      if (movie.sourcePath === sourcePath) return movie;
    }
    return undefined;
  }

  getByStatus(status: Movie['status']): Movie[] {
    return this.getAll().filter((m) => m.status === status);
  }

  count(): number {
    return this.movies.size;
  }

  countByStatus(status: Movie['status']): number {
    return this.getByStatus(status).length;
  }
}
