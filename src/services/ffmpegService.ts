import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { FfprobeOutput, QUALITY_PROFILES, QualityProfile } from '../types/movie.js';
import { ensureDir, moveDir, safeRemoveDir, writeJsonFile } from '../utils/filesystem.js';
import { logger } from '../utils/logger.js';
import { HlsMetadata } from '../types/movie.js';

export interface MediaInfo {
  durationSeconds: number;
  width: number;
  height: number;
  videoCodec: string;
  audioCodec: string;
  hasVideo: boolean;
  hasAudio: boolean;
}

export interface TranscodeOptions {
  movieId: string;
  inputPath: string;
  hlsDirectory: string;     // Root HLS output dir (e.g. D:\MovieStream\hls)
  segmentDuration: number;
  profiles: QualityProfile[];
  sourceInfo: MediaInfo;
  ffmpegPath: string;
  // Source file stats for metadata.json
  sourceSizeBytes: number;
  sourceModifiedTime: number;
  // Optional cancellation signal
  signal?: AbortSignal;
  /**
   * Called periodically during transcoding with an overall progress value
   * from 0 to 100 across all quality profiles, and the current profile name.
   */
  onProgress?: (percent: number, profileName: string) => void;
}

/**
 * Validates that the ffmpeg binary is executable.
 */
export async function validateFfmpeg(ffmpegPath: string): Promise<void> {
  return validateBinary(ffmpegPath, 'FFmpeg');
}

/**
 * Validates that the ffprobe binary is executable.
 */
export async function validateFfprobe(ffprobePath: string): Promise<void> {
  return validateBinary(ffprobePath, 'FFprobe');
}

async function validateBinary(binaryPath: string, name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(binaryPath, ['-version'], { stdio: 'pipe' });

    proc.on('error', (err) => {
      reject(
        new Error(
          `${name} could not be started at "${binaryPath}". ` +
            `Please install ${name} and ensure it is on your PATH, ` +
            `or set the correct path in your .env file.\n` +
            `Original error: ${err.message}`,
        ),
      );
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${name} at "${binaryPath}" exited with code ${code}`));
      }
    });
  });
}

/**
 * Runs ffprobe on a file and returns media information.
 * Rejects if the file has no valid video stream.
 */
export async function getMediaInfo(filePath: string, ffprobePath: string): Promise<MediaInfo> {
  const output = await runFfprobe(filePath, ffprobePath);

  const videoStream = output.streams.find((s) => s.codec_type === 'video');
  const audioStream = output.streams.find((s) => s.codec_type === 'audio');

  if (!videoStream) {
    throw new Error(`No valid video stream found in: ${path.basename(filePath)}`);
  }

  const durationStr = output.format.duration;
  const durationSeconds = durationStr ? parseFloat(durationStr) : 0;

  return {
    durationSeconds,
    width: videoStream.width ?? 0,
    height: videoStream.height ?? 0,
    videoCodec: videoStream.codec_name,
    audioCodec: audioStream?.codec_name ?? '',
    hasVideo: true,
    hasAudio: !!audioStream,
  };
}

function runFfprobe(filePath: string, ffprobePath: string): Promise<FfprobeOutput> {
  return new Promise((resolve, reject) => {
    const args = [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      filePath,
    ];

    const proc = spawn(ffprobePath, args, { stdio: 'pipe' });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    proc.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on('error', (err) => {
      reject(new Error(`ffprobe failed to start: ${err.message}`));
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`ffprobe exited with code ${code}: ${stderr.slice(-500)}`));
        return;
      }

      try {
        const parsed = JSON.parse(stdout) as FfprobeOutput;
        resolve(parsed);
      } catch {
        reject(new Error(`Failed to parse ffprobe JSON output`));
      }
    });
  });
}

/**
 * Selects which quality profiles to generate based on source resolution.
 * Avoids unnecessary upscaling.
 */
export function selectQualityProfiles(
  sourceHeight: number,
  config: { transcode480p: boolean; transcode720p: boolean; transcode1080p: boolean },
  allProfiles: QualityProfile[] = QUALITY_PROFILES,
): QualityProfile[] {
  return allProfiles.filter((p) => {
    if (p.name === '480p' && !config.transcode480p) return false;
    if (p.name === '720p' && !config.transcode720p) return false;
    if (p.name === '1080p' && !config.transcode1080p) return false;
    // Do not upscale: only generate a profile if source is at least as tall
    return sourceHeight >= p.height;
  });
}

/**
 * Transcodes a movie to HLS using FFmpeg.
 *
 * Process:
 *   1. Create a temp output directory
 *   2. Transcode each quality profile with FFmpeg
 *   3. Write master.m3u8
 *   4. Write metadata.json
 *   5. Atomically rename temp dir to final dir
 *   6. On failure: clean up temp dir
 */
export async function transcodeToHls(opts: TranscodeOptions): Promise<void> {
  const {
    movieId,
    inputPath,
    hlsDirectory,
    segmentDuration,
    profiles,
    ffmpegPath,
    sourceSizeBytes,
    sourceModifiedTime,
    signal,
    onProgress,
    sourceInfo,
  } = opts;

  const finalDir = path.join(hlsDirectory, movieId);
  const tempDir = path.join(hlsDirectory, `.tmp-${movieId}`);

  // Remove any leftover temp dir from a previous failed run
  await safeRemoveDir(tempDir);
  await ensureDir(tempDir);

  const totalProfiles = profiles.length;

  try {
    for (let i = 0; i < profiles.length; i++) {
      const profile = profiles[i];
      if (signal?.aborted) throw new Error('Transcoding cancelled');

      const profileDir = path.join(tempDir, profile.name);
      await ensureDir(profileDir);

      // Each profile gets an equal share of the overall 0–100% range.
      // e.g. with 3 profiles: 0–33%, 33–66%, 66–100%
      const profileStart = (i / totalProfiles) * 100;
      const profileEnd = ((i + 1) / totalProfiles) * 100;

      await transcodeProfile(
        inputPath,
        profileDir,
        profile,
        segmentDuration,
        ffmpegPath,
        sourceInfo.durationSeconds,
        signal,
        onProgress
          ? (innerPercent: number) => {
              const overall = Math.round(
                profileStart + (innerPercent / 100) * (profileEnd - profileStart),
              );
              onProgress(overall, profile.name);
            }
          : undefined,
      );
      logger.info(`FFmpeg completed ${profile.name} for ${movieId}`);
    }

    // Signal 100% when all profiles are done
    if (onProgress && profiles.length > 0) {
      onProgress(100, profiles[profiles.length - 1].name);
    }

    // Write master.m3u8
    await writeMasterPlaylist(tempDir, profiles);

    // Write metadata.json for stale detection
    const metadata: HlsMetadata = {
      sourcePath: inputPath,
      sourceSizeBytes,
      sourceModifiedTime,
      generatedAt: new Date().toISOString(),
    };
    await writeJsonFile(path.join(tempDir, 'metadata.json'), metadata);

    // Atomic move: temp → final
    if (await directoryExists(finalDir)) {
      await safeRemoveDir(finalDir);
    }
    await moveDir(tempDir, finalDir);

    logger.info(`HLS output ready: ${finalDir}`);
  } catch (err) {
    // Cleanup temp directory on failure
    await safeRemoveDir(tempDir);
    throw err;
  }
}

function transcodeProfile(
  inputPath: string,
  outputDir: string,
  profile: QualityProfile,
  segmentDuration: number,
  ffmpegPath: string,
  durationSeconds: number,
  signal?: AbortSignal,
  onProgress?: (percent: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('Transcoding cancelled before start'));
      return;
    }

    const playlistPath = path.join(outputDir, 'playlist.m3u8');
    const segmentPattern = path.join(outputDir, 'segment_%03d.ts');

    // Build scale filter that preserves aspect ratio and ensures even dimensions
    // force_original_aspect_ratio=decrease: never stretches, letterboxes if needed
    // pad + ceil ensures H.264 even-dimension requirements
    const scaleFilter =
      `scale=${profile.width}:${profile.height}:` +
      `force_original_aspect_ratio=decrease,` +
      `pad=${profile.width}:${profile.height}:(ow-iw)/2:(oh-ih)/2,` +
      `format=yuv420p`;

    const args = [
      '-i', inputPath,
      '-map', '0:v:0',
      '-map', '0:a:0?',
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '23',
      '-maxrate', profile.videoBitrate,
      '-bufsize', `${parseInt(profile.videoBitrate) * 2}k`,
      '-vf', scaleFilter,
      '-c:a', 'aac',
      '-b:a', profile.audioBitrate,
      '-ac', '2',
      '-f', 'hls',
      '-hls_time', String(segmentDuration),
      '-hls_list_size', '0',
      '-hls_segment_type', 'mpegts',
      '-hls_segment_filename', segmentPattern,
      '-hls_flags', 'independent_segments',
      '-progress', 'pipe:2',  // Write progress to stderr in key=value format
      '-nostats',
      playlistPath,
    ];

    logger.info(`FFmpeg starting ${profile.name} for ${path.basename(inputPath)}`);

    const proc = spawn(ffmpegPath, args, { stdio: 'pipe' });

    let stderrOutput = '';
    let stderrBuffer = '';

    // Parse FFmpeg progress lines from stderr.
    // FFmpeg with -progress pipe:2 writes key=value pairs; we look for out_time_us
    // and fall back to the human-readable "time=HH:MM:SS.xx" pattern.
    proc.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      stderrOutput += text;
      stderrBuffer += text;

      // Process complete lines
      const lines = stderrBuffer.split('\n');
      stderrBuffer = lines.pop() ?? ''; // keep incomplete last line

      for (const line of lines) {
        // -progress pipe:2 emits: out_time_us=<microseconds>
        const usMatch = line.match(/^out_time_us=(\d+)/);
        if (usMatch && durationSeconds > 0 && onProgress) {
          const elapsedSec = parseInt(usMatch[1], 10) / 1_000_000;
          const pct = Math.min(99, Math.round((elapsedSec / durationSeconds) * 100));
          onProgress(pct);
          continue;
        }

        // Fallback: human-readable "time=HH:MM:SS.xx" from regular FFmpeg output
        const timeMatch = line.match(/time=(\d+):(\d+):(\d+\.\d+)/);
        if (timeMatch && durationSeconds > 0 && onProgress) {
          const elapsed =
            parseInt(timeMatch[1], 10) * 3600 +
            parseInt(timeMatch[2], 10) * 60 +
            parseFloat(timeMatch[3]);
          const pct = Math.min(99, Math.round((elapsed / durationSeconds) * 100));
          onProgress(pct);
        }
      }
    });

    if (signal) {
      signal.addEventListener('abort', () => {
        proc.kill('SIGTERM');
        reject(new Error('Transcoding was cancelled'));
      }, { once: true });
    }

    proc.on('error', (err) => {
      reject(new Error(`FFmpeg process error: ${err.message}`));
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        const lastLines = stderrOutput.split('\n').slice(-20).join('\n');
        reject(new Error(`FFmpeg exited with code ${code}.\n${lastLines}`));
      }
    });
  });
}

async function writeMasterPlaylist(outputDir: string, profiles: QualityProfile[]): Promise<void> {
  const bandwidthMap: Record<string, number> = {
    '480p': 1400000,
    '720p': 2996000,
    '1080p': 5128000,
  };
  const resolutionMap: Record<string, string> = {
    '480p': '854x480',
    '720p': '1280x720',
    '1080p': '1920x1080',
  };

  let content = '#EXTM3U\n#EXT-X-VERSION:3\n\n';

  for (const profile of profiles) {
    const bandwidth = bandwidthMap[profile.name] ?? 2000000;
    const resolution = resolutionMap[profile.name] ?? `${profile.width}x${profile.height}`;
    content += `#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth},RESOLUTION=${resolution},CODECS="avc1.42e01e,mp4a.40.2"\n`;
    content += `${profile.name}/playlist.m3u8\n\n`;
  }

  await fs.writeFile(path.join(outputDir, 'master.m3u8'), content, 'utf-8');
}

async function directoryExists(dirPath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(dirPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}
