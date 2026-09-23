/** Shared formatting + presentational helpers for the CineStream UI. */

/** 5025 → "1:23:45", 125 → "2:05" */
export function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** 5025 → "1h 23m", 125 → "2m" */
export function formatDuration(seconds?: number): string {
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) return 'Runtime unknown';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function formatSize(bytes: number): string {
  if (!bytes || !Number.isFinite(bytes) || bytes <= 0) return '—';
  const gb = bytes / 1024 ** 3;
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  const mb = bytes / 1024 ** 2;
  return `${mb.toFixed(0)} MB`;
}

/** Fraction watched, clamped to 0..1 */
export function progressRatio(time: number, duration: number): number {
  if (!duration || duration <= 0) return 0;
  return Math.min(1, Math.max(0, time / duration));
}

/**
 * A movie counts as "finished" once the viewer is within the final 2% or the
 * last 90 seconds — same threshold used by most streaming clients.
 */
export function isFinished(time: number, duration: number): boolean {
  if (!duration || duration <= 0) return false;
  return duration - time <= Math.max(30, duration * 0.02);
}

/** Pulls a 4-digit year out of titles like "Blade Runner (1982)". */
export function extractYear(title: string): string | null {
  const match = title.match(/\((\d{4})\)/);
  return match ? match[1]! : null;
}

/** Strips a trailing "(2008)" / "[2008]" so the display title stays clean. */
export function cleanTitle(title: string): string {
  return title.replace(/\s*[([(]\d{4}[)\]]\s*$/, '').trim() || title;
}

const GRADIENTS: string[][] = [
  ['#1f2b6c', '#0b1030'],
  ['#6d1b3a', '#1a0711'],
  ['#0f4c5c', '#05202a'],
  ['#5a2a7a', '#160b21'],
  ['#7a3b12', '#220f05'],
  ['#123c2b', '#05130d'],
  ['#8a1f2f', '#25070c'],
  ['#274690', '#0a1230'],
  ['#8a6d1f', '#241c06'],
  ['#2f4858', '#0c1418'],
];

function hashString(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Deterministic cinematic backdrop for a movie. Posters are not available from
 * the API, so each title gets a stable gradient derived from its id.
 */
export function posterGradient(id: string): string {
  const h = hashString(id);
  const [a, b] = GRADIENTS[h % GRADIENTS.length]!;
  const angle = 110 + (h % 80);
  return `linear-gradient(${angle}deg, ${a} 0%, ${b} 100%)`;
}

/** "3.2 GB • 2h 08m • 1080p" — metadata line used on cards and the billboard. */
export function metaLine(movie: {
  sizeBytes?: number;
  durationSeconds?: number;
  height?: number;
}): string {
  return [
    formatDuration(movie.durationSeconds),
    movie.height ? `${movie.height}p` : null,
    movie.sizeBytes ? formatSize(movie.sizeBytes) : null,
  ]
    .filter(Boolean)
    .join('  •  ');
}