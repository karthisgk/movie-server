export type MovieStatus =
  | 'discovered'
  | 'queued'
  | 'processing'
  | 'partial'    // ≥1 profile done — movie is playable but still transcoding
  | 'ready'
  | 'failed';

export interface Movie {
  id: string;
  title: string;
  filename: string;
  sourcePath: string;

  extension: string;
  sizeBytes: number;

  status: MovieStatus;

  /** Transcoding progress percentage (0–100). Only meaningful when status === 'processing' or 'partial'. */
  transcodingProgress?: number;
  /** The quality profile currently being transcoded, e.g. '480p', '720p', '1080p'. */
  transcodingProfile?: string;
  /** Quality profiles that have finished transcoding, e.g. ['1080p', '720p']. */
  completedProfiles?: string[];

  /**
   * Whether the original source file is still present on disk.
   * false = source was removed/moved but HLS is still valid and being served.
   * Defaults to true when undefined.
   */
  sourceAvailable?: boolean;

  durationSeconds?: number;

  width?: number;
  height?: number;

  videoCodec?: string;
  audioCodec?: string;

  createdAt: string;
  updatedAt: string;

  error?: string;
}

/** Stored inside the HLS output directory to detect stale transcodes and rebuild registry */
export interface HlsMetadata {
  sourcePath: string;
  sourceSizeBytes: number;
  sourceModifiedTime: number;
  generatedAt: string;
  // Rich fields written at transcode time — used to reconstruct registry when source is gone
  title?: string;
  filename?: string;
  durationSeconds?: number;
  width?: number;
  height?: number;
  videoCodec?: string;
  audioCodec?: string;
  /** Profiles that completed before a crash — used to resume partial transcoding on restart. */
  completedProfiles?: string[];
}

export interface QualityProfile {
  name: '480p' | '720p' | '1080p';
  width: number;
  height: number;
  videoBitrate: string;
  audioBitrate: string;
}

export const QUALITY_PROFILES: QualityProfile[] = [
  { name: '480p', width: 854, height: 480, videoBitrate: '1200k', audioBitrate: '128k' },
  { name: '720p', width: 1280, height: 720, videoBitrate: '2800k', audioBitrate: '128k' },
  { name: '1080p', width: 1920, height: 1080, videoBitrate: '5000k', audioBitrate: '128k' },
];

export const SUPPORTED_EXTENSIONS = new Set(['.mp4', '.mkv', '.mov', '.avi', '.m4v', '.webm']);

export interface FfprobeStreamInfo {
  codec_type: string;
  codec_name: string;
  width?: number;
  height?: number;
}

export interface FfprobeFormatInfo {
  duration?: string;
}

export interface FfprobeOutput {
  streams: FfprobeStreamInfo[];
  format: FfprobeFormatInfo;
}
