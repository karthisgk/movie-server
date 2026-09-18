import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { FfprobeOutput, QUALITY_PROFILES, QualityProfile } from '../types/movie.js';
import { ensureDir, writeJsonFile } from '../utils/filesystem.js';
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
   * from 0 to 100 across all remaining (not-yet-completed) quality profiles,
   * and the current profile name.
   */
  onProgress?: (percent: number, profileName: string) => void;
  /**
   * Called immediately after each quality profile finishes.
   * `completedSoFar` contains all profiles (including any pre-existing ones)
   * that are done at this point.
   */
  onProfileComplete?: (profile: QualityProfile, completedSoFar: QualityProfile[]) => void;
  /**
   * Profiles that were already transcoded before this call (crash-recovery).
   * These will be skipped during transcoding but included in master.m3u8 output.
   */
  alreadyCompleted?: QualityProfile[];
  /** Movie title and filename, stored in metadata.json for source-less registry recovery */
  title?: string;
  filename?: string;
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
 * Scans an HLS output directory and returns which quality profiles have
 * already been fully transcoded (i.e. their playlist.m3u8 exists).
 * Used for crash-recovery: allows resuming from where we left off.
 */
export async function detectCompletedProfiles(
  movieId: string,
  hlsDirectory: string,
  allProfiles: QualityProfile[],
): Promise<QualityProfile[]> {
  const completed: QualityProfile[] = [];
  for (const profile of allProfiles) {
    const playlistPath = path.join(hlsDirectory, movieId, profile.name, 'playlist.m3u8');
    try {
      await fs.access(playlistPath);
      completed.push(profile);
    } catch {
      // playlist doesn't exist — not done
    }
  }
  return completed;
}

import { Worker } from 'worker_threads';
import { TranscodeWorkerData, WorkerToMainMessage, MainToWorkerMessage } from './transcodeWorker.js';

/**
 * Transcodes a movie to HLS using FFmpeg concurrently in Worker Threads per resolution.
 *
 * Process:
 *   1. Sort profiles descending (1080p → 720p → 480p) — best quality first
 *   2. Skip profiles already completed (crash-recovery via alreadyCompleted)
 *   3. Launch Node Worker Threads in parallel for each remaining quality profile
 *   4. Calculate overall progress % out of 100 across all profiles
 *   5. When any worker completes a profile: update master.m3u8 immediately
 *      → movie becomes playable as soon as the first profile finishes
 *   6. Write metadata.json when all profiles are done
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
    onProfileComplete,
    alreadyCompleted = [],
    sourceInfo,
  } = opts;

  const finalDir = path.join(hlsDirectory, movieId);
  await ensureDir(finalDir);

  // Sort profiles highest-quality first (1080p → 720p → 480p)
  const sortedProfiles = [...profiles].sort((a, b) => b.height - a.height);

  // Build the list of profiles we still need to transcode
  const alreadyDoneNames = new Set(alreadyCompleted.map((p) => p.name));
  const toTranscode = sortedProfiles.filter((p) => !alreadyDoneNames.has(p.name));

  // Track all completed profiles (pre-existing + newly done), sorted highest first
  const completedProfiles: QualityProfile[] = [...alreadyCompleted].sort((a, b) => b.height - a.height);

  const totalProfilesCount = sortedProfiles.length;
  if (totalProfilesCount === 0) {
    return;
  }

  // Track progress (0–100) per profile for accurate combined 0–100% progress
  const profileProgressMap: Record<string, number> = {};
  for (const p of sortedProfiles) {
    profileProgressMap[p.name] = alreadyDoneNames.has(p.name) ? 100 : 0;
  }

  const updateOverallProgress = () => {
    if (!onProgress) return;
    const sumProgress = sortedProfiles.reduce((acc, p) => acc + (profileProgressMap[p.name] ?? 0), 0);
    const overallPercent = Math.min(100, Math.round(sumProgress / totalProfilesCount));

    const activeProfiles = toTranscode
      .filter((p) => (profileProgressMap[p.name] ?? 0) < 100)
      .map((p) => p.name);
    const currentProfileName = activeProfiles.join('+') || sortedProfiles[0].name;

    onProgress(overallPercent, currentProfileName);
  };

  // Initial progress update
  updateOverallProgress();

  if (toTranscode.length === 0) {
    await writeMasterPlaylist(finalDir, completedProfiles);
    if (onProgress) {
      onProgress(100, sortedProfiles[0].name);
    }
    return;
  }

  // Determine worker thread module path
  const isTs = path.extname(import.meta.url) === '.ts';
  const workerExt = isTs ? '.ts' : '.js';
  const workerUrl = new URL(`./transcodeWorker${workerExt}`, import.meta.url);

  const activeWorkers: Worker[] = [];

  const handleAbort = () => {
    for (const worker of activeWorkers) {
      const msg: MainToWorkerMessage = { type: 'cancel' };
      try {
        worker.postMessage(msg);
        worker.terminate().catch(() => {});
      } catch {
        // worker may already be terminated
      }
    }
  };

  if (signal) {
    signal.addEventListener('abort', handleAbort, { once: true });
  }

  try {
    const workerPromises = toTranscode.map(async (profile) => {
      const profileDir = path.join(finalDir, profile.name);
      await ensureDir(profileDir);

      const workerData: TranscodeWorkerData = {
        inputPath,
        outputDir: profileDir,
        profile,
        segmentDuration,
        ffmpegPath,
        durationSeconds: sourceInfo.durationSeconds,
      };

      return new Promise<void>((resolve, reject) => {
        if (signal?.aborted) {
          reject(new Error('Transcoding cancelled before start'));
          return;
        }

        const worker = new Worker(workerUrl, {
          workerData,
          execArgv: process.execArgv,
        });
        activeWorkers.push(worker);

        let isDone = false;

        const cleanup = () => {
          const index = activeWorkers.indexOf(worker);
          if (index !== -1) {
            activeWorkers.splice(index, 1);
          }
          try {
            worker.terminate().catch(() => {});
          } catch {
            // ignore if already terminated
          }
        };

        worker.on('message', async (msg: WorkerToMainMessage) => {
          if (msg.type === 'progress') {
            profileProgressMap[profile.name] = msg.percent;
            updateOverallProgress();
          } else if (msg.type === 'complete') {
            profileProgressMap[profile.name] = 100;
            updateOverallProgress();

            logger.info(`Worker thread completed ${profile.name} for ${movieId}`);

            if (!completedProfiles.some((p) => p.name === profile.name)) {
              completedProfiles.push(profile);
              completedProfiles.sort((a, b) => b.height - a.height);
              await writeMasterPlaylist(finalDir, completedProfiles);
              logger.info(`master.m3u8 updated for ${movieId} — available: ${completedProfiles.map((p) => p.name).join(', ')}`);

              if (onProfileComplete) {
                onProfileComplete(profile, [...completedProfiles]);
              }
            }

            if (!isDone) {
              isDone = true;
              cleanup();
              resolve();
            }
          } else if (msg.type === 'error') {
            if (!isDone) {
              isDone = true;
              cleanup();
              reject(new Error(msg.error));
            }
          }
        });

        worker.on('error', (err) => {
          if (!isDone) {
            isDone = true;
            cleanup();
            reject(new Error(`Worker thread error for ${profile.name}: ${err.message}`));
          }
        });

        worker.on('exit', (code) => {
          if (!isDone) {
            isDone = true;
            cleanup();
            if (code === 0) {
              resolve();
            } else if (!signal?.aborted) {
              reject(new Error(`Worker thread for ${profile.name} exited with code ${code}`));
            } else {
              reject(new Error('Transcoding was cancelled'));
            }
          }
        });
      });
    });

    await Promise.all(workerPromises);

    if (onProgress) {
      onProgress(100, sortedProfiles[0].name);
    }

    // Write metadata.json for stale detection and source-less registry recovery
    const allCompleted = [...completedProfiles];
    const metadata: HlsMetadata = {
      sourcePath: inputPath,
      sourceSizeBytes,
      sourceModifiedTime,
      generatedAt: new Date().toISOString(),
      title: opts.title,
      filename: opts.filename ?? path.basename(inputPath),
      durationSeconds: sourceInfo.durationSeconds,
      width: sourceInfo.width,
      height: sourceInfo.height,
      videoCodec: sourceInfo.videoCodec,
      audioCodec: sourceInfo.audioCodec,
      completedProfiles: allCompleted.map((p) => p.name),
    };
    await writeJsonFile(path.join(finalDir, 'metadata.json'), metadata);

    logger.info(`HLS output ready: ${finalDir}`);
  } catch (err) {
    handleAbort();
    logger.warn(`Transcoding interrupted for ${movieId} — partial output preserved for recovery`);
    throw err;
  } finally {
    if (signal) {
      signal.removeEventListener('abort', handleAbort);
    }
  }
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

