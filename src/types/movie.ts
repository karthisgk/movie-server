export type MovieStatus =
  | 'discovered'
  | 'queued'
  | 'processing'
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

  durationSeconds?: number;

  width?: number;
  height?: number;

  videoCodec?: string;
  audioCodec?: string;

  createdAt: string;
  updatedAt: string;

  error?: string;
}

/** Stored inside the HLS output directory to detect stale transcodes */
export interface HlsMetadata {
  sourcePath: string;
  sourceSizeBytes: number;
  sourceModifiedTime: number;
  generatedAt: string;
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
