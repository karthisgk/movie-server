export type MovieStatus =
  | 'discovered'
  | 'queued'
  | 'processing'
  | 'partial'
  | 'ready'
  | 'failed';

/** Public movie representation returned by GET /videos (no filesystem paths). */
export interface PublicMovie {
  id: string;
  title: string;
  filename: string;
  status: MovieStatus;
  /** false when the original source file is gone but HLS is still served */
  sourceAvailable: boolean;
  sizeBytes: number;
  durationSeconds?: number;
  width?: number;
  height?: number;
  videoCodec?: string;
  audioCodec?: string;
  createdAt: string;
  updatedAt: string;
  playUrl: string;
  /** Only present while status is 'processing' or 'partial' */
  transcodingProgress?: number;
  transcodingProfile?: string | null;
  /** Quality profiles that finished transcoding, e.g. ['1080p', '720p'] */
  completedProfiles?: string[];
  error?: string;
}

/** GET /videos/:id/subtitles */
export interface SubtitleTrack {
  /** Stream index within the source file */
  index: number;
  /** Sequential subtitle track number (0-based) */
  trackIndex: number;
  /** ISO 639-2 language code, e.g. 'eng' */
  language: string;
  /** Human-readable label, e.g. 'English' */
  label: string;
  /** Relative URL to the WebVTT file */
  url: string;
}

/** Locally persisted watch progress for a single movie. */
export interface WatchProgress {
  movieId: string;
  /** Playback position in seconds */
  time: number;
  /** Total duration in seconds (0 when unknown) */
  duration: number;
  /** Epoch millis of the last update */
  updatedAt: number;
}