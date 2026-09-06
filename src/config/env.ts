import 'dotenv/config';
import path from 'path';

function requireEnv(key: string): string {
  const val = process.env[key];
  if (!val) {
    throw new Error(`Missing required environment variable: ${key}. See .env.example for reference.`);
  }
  return val;
}

function getEnvBool(key: string, defaultVal: boolean): boolean {
  const val = process.env[key];
  if (val === undefined || val === '') return defaultVal;
  return val.toLowerCase() === 'true';
}

function getEnvInt(key: string, defaultVal: number): number {
  const val = process.env[key];
  if (!val) return defaultVal;
  const parsed = parseInt(val, 10);
  if (isNaN(parsed)) {
    throw new Error(`Environment variable ${key} must be an integer, got: ${val}`);
  }
  return parsed;
}

export interface AppConfig {
  movieDirectory: string;
  hlsDirectory: string;
  host: string;
  port: number;
  ffmpegPath: string;
  ffprobePath: string;
  transcode480p: boolean;
  transcode720p: boolean;
  transcode1080p: boolean;
  hlsSegmentDuration: number;
  maxConcurrentTranscodes: number;
  autoTranscode: boolean;
}

function loadConfig(): AppConfig {
  const movieDirectory = requireEnv('MOVIE_DIRECTORY');
  const hlsDirectory = requireEnv('HLS_DIRECTORY');

  // Normalise Windows paths (env vars may use forward or back slashes)
  return {
    movieDirectory: path.normalize(movieDirectory),
    hlsDirectory: path.normalize(hlsDirectory),
    host: process.env['HOST'] ?? '0.0.0.0',
    port: getEnvInt('PORT', 5000),
    ffmpegPath: process.env['FFMPEG_PATH'] ?? 'ffmpeg',
    ffprobePath: process.env['FFPROBE_PATH'] ?? 'ffprobe',
    transcode480p: getEnvBool('TRANSCODE_480P', true),
    transcode720p: getEnvBool('TRANSCODE_720P', true),
    transcode1080p: getEnvBool('TRANSCODE_1080P', true),
    hlsSegmentDuration: getEnvInt('HLS_SEGMENT_DURATION', 6),
    maxConcurrentTranscodes: getEnvInt('MAX_CONCURRENT_TRANSCODES', 1),
    autoTranscode: getEnvBool('AUTO_TRANSCODE', true),
  };
}

export const config = loadConfig();
