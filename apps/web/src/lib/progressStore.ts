import { WatchProgress } from '../types';
import { isFinished } from './format';

/**
 * Tiny localStorage-backed watch-progress store.
 *
 * Kept outside React so the player can write on a timer without re-rendering
 * the whole tree, while rows subscribe via useSyncExternalStore. The snapshot
 * object identity only changes on mutation, which keeps subscribers stable.
 */

const STORAGE_KEY = 'cinestream.progress.v1';
const MAX_ENTRIES = 200;
const EMPTY: Record<string, WatchProgress> = {};

type ProgressMap = Record<string, WatchProgress>;

function load(): ProgressMap {
  if (typeof localStorage === 'undefined') return EMPTY;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return EMPTY;
    const out: ProgressMap = {};
    for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
      const v = value as Partial<WatchProgress>;
      if (typeof v?.time !== 'number' || !Number.isFinite(v.time)) continue;
      out[id] = {
        movieId: id,
        time: v.time,
        duration: typeof v.duration === 'number' ? v.duration : 0,
        updatedAt: typeof v.updatedAt === 'number' ? v.updatedAt : 0,
      };
    }
    return out;
  } catch {
    return EMPTY;
  }
}

let cache: ProgressMap = load();
const listeners = new Set<() => void>();

function persist(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const entries = Object.values(cache)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_ENTRIES);
    const trimmed: ProgressMap = {};
    for (const entry of entries) trimmed[entry.movieId] = entry;
    cache = trimmed;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    // Storage full / private mode — progress simply is not persisted.
  }
}

function emit(): void {
  for (const listener of listeners) listener();
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getSnapshot(): ProgressMap {
  return cache;
}

export function getServerSnapshot(): ProgressMap {
  return EMPTY;
}

export function getProgress(movieId: string): WatchProgress | undefined {
  return cache[movieId];
}

/**
 * Records a playback position. Positions near the end are promoted to
 * "finished" and dropped from Continue Watching.
 */
export function saveProgress(movieId: string, time: number, duration: number): void {
  if (!Number.isFinite(time) || time < 1) return;
  const next: ProgressMap = { ...cache };

  if (isFinished(time, duration)) {
    delete next[movieId];
  } else {
    next[movieId] = { movieId, time, duration: duration || 0, updatedAt: Date.now() };
  }

  cache = next;
  persist();
  emit();
}

export function clearProgress(movieId: string): void {
  if (!(movieId in cache)) return;
  const next = { ...cache };
  delete next[movieId];
  cache = next;
  persist();
  emit();
}