import { spawn } from 'child_process';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { AudioTrackInfo, EXTRACTING_AUDIO_PROFILE, FfprobeOutput, QUALITY_PROFILES, QualityProfile } from '../types/movie.js';
import { ensureDir, fileExists, writeJsonFile } from '../utils/filesystem.js';
import { logger } from '../utils/logger.js';
import { HlsMetadata } from '../types/movie.js';
import { ensureAudioTrackExtracted, isPlaylistComplete } from './audioExtractionService.js';
import { prioritizeAudioTracks, resolveSourceAudioIndex } from './audioTrackPrioritizer.js';

export interface MediaInfo {
  durationSeconds: number;
  width: number;
  height: number;
  videoCodec: string;
  audioCodec: string;
  hasVideo: boolean;
  hasAudio: boolean;
  /** All audio tracks discovered in the source file */
  audioTracks: AudioTrackInfo[];
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
  /**
   * Use the chunk-based waterfall pipeline (sequential resolutions, parallel
   * chunks). Defaults to true; set false to use the legacy whole-file workers.
   */
  chunked?: boolean;
  /** Length of each transcode chunk in seconds (aligned to whole segments). Default 120. */
  chunkDurationSeconds?: number;
  /** Concurrent chunk workers. 0/undefined = auto (min(floor(cores / 2), 6)). */
  chunkWorkers?: number;
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
  const audioStreams = output.streams.filter((s) => s.codec_type === 'audio');
  const audioStream = audioStreams[0];

  if (!videoStream) {
    throw new Error(`No valid video stream found in: ${path.basename(filePath)}`);
  }

  const durationStr = output.format.duration;
  const durationSeconds = durationStr ? parseFloat(durationStr) : 0;

  // Build audio track info for every audio stream, then reorder so Tamil is
  // presented first (index 0). `sourceAudioIndex` preserves the true stream
  // position for extraction regardless of the presentation order.
  const detectedTracks: AudioTrackInfo[] = audioStreams.map((s, idx) => {
    const lang = s.tags?.language ?? 'und';
    const title = s.tags?.title;
    const channels = s.channels ?? 2;
    const channelLabel = channels >= 6 ? '5.1' : channels === 1 ? 'Mono' : 'Stereo';
    const langName = languageCodeToName(lang);
    let label = langName;
    if (title && !title.toLowerCase().includes(langName.toLowerCase()) && lang !== 'und') {
      label = `${langName} - ${title} (${channelLabel})`;
    } else if (title) {
      label = `${title} (${channelLabel})`;
    } else {
      label = `${langName} (${channelLabel})`;
    }
    return {
      streamIndex: s.index ?? idx,
      sourceAudioIndex: idx,
      language: lang,
      label,
      codec: s.codec_name,
      channels,
    };
  });

  const audioTracks = prioritizeAudioTracks(detectedTracks);

  return {
    durationSeconds,
    width: videoStream.width ?? 0,
    height: videoStream.height ?? 0,
    videoCodec: videoStream.codec_name,
    audioCodec: audioStream?.codec_name ?? '',
    hasVideo: true,
    hasAudio: !!audioStream,
    audioTracks,
  };
}

/** Map common ISO 639-2/3 language codes to human-readable names. */
function languageCodeToName(code: string): string {
  const map: Record<string, string> = {
    eng: 'English', hin: 'Hindi', tam: 'Tamil', tel: 'Telugu',
    kan: 'Kannada', mal: 'Malayalam', mar: 'Marathi', ben: 'Bengali',
    guj: 'Gujarati', pan: 'Punjabi', urd: 'Urdu', spa: 'Spanish',
    fre: 'French', fra: 'French', ger: 'German', deu: 'German',
    ita: 'Italian', por: 'Portuguese', rus: 'Russian', jpn: 'Japanese',
    kor: 'Korean', chi: 'Chinese', zho: 'Chinese', ara: 'Arabic',
    tha: 'Thai', vie: 'Vietnamese', ind: 'Indonesian', may: 'Malay',
    msa: 'Malay', tur: 'Turkish', pol: 'Polish', nld: 'Dutch',
    dut: 'Dutch', swe: 'Swedish', nor: 'Norwegian', dan: 'Danish',
    fin: 'Finnish', ces: 'Czech', cze: 'Czech', ron: 'Romanian',
    rum: 'Romanian', hun: 'Hungarian', und: 'Unknown',
  };
  return map[code.toLowerCase()] ?? code.toUpperCase();
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
  config: { transcode480p: boolean; transcode720p: boolean; transcode1080p: boolean; transcode2160p: boolean },
  allProfiles: QualityProfile[] = QUALITY_PROFILES,
): QualityProfile[] {
  return allProfiles.filter((p) => {
    if (p.name === '480p' && !config.transcode480p) return false;
    if (p.name === '720p' && !config.transcode720p) return false;
    if (p.name === '1080p' && !config.transcode1080p) return false;
    if (p.name === '2160p' && !config.transcode2160p) return false;
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
    // A playlist is only "done" once it has #EXT-X-ENDLIST — otherwise an
    // interrupted transcode would be treated as complete and seeking past the
    // produced range would stall.
    if (await isPlaylistComplete(playlistPath)) {
      completed.push(profile);
    }
  }
  return completed;
}

import { Worker } from 'worker_threads';
import { TranscodeWorkerData, WorkerToMainMessage, MainToWorkerMessage } from './transcodeWorker.js';
import { ChunkWorkerData, ChunkWorkerToMain } from './transcodeChunkWorker.js';
import { planTranscodeChunks, aggregateChunkProgress, TranscodeChunk } from './transcodeChunkPlanner.js';
import { stitchChunks, cleanProfileHlsOutput } from './chunkStitcher.js';

/**
 * Transcodes a movie to HLS using FFmpeg concurrently in Worker Threads per resolution.
 *
 * Process:
 *   1. Sort profiles descending (2160p → 1080p → 720p → 480p) — best quality first
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
    chunked = true,
    chunkDurationSeconds = 120,
    chunkWorkers = 0,
  } = opts;

  const finalDir = path.join(hlsDirectory, movieId);
  await ensureDir(finalDir);

  // Never upscale: drop any profile taller than the source. This is a defensive
  // guard — callers already pass profiles filtered by selectQualityProfiles, but
  // it guarantees a 1080p source can never be rendered up to a 2160p rendition.
  const nonUpscalingProfiles =
    sourceInfo.height > 0
      ? profiles.filter((p) => p.height <= sourceInfo.height)
      : profiles;
  if (nonUpscalingProfiles.length !== profiles.length) {
    const dropped = profiles
      .filter((p) => p.height > sourceInfo.height)
      .map((p) => p.name)
      .join(', ');
    logger.warn(
      `Skipping profile(s) taller than source (${sourceInfo.width}x${sourceInfo.height}): ${dropped}`,
    );
  }

  // Sort profiles highest-quality first (2160p → 1080p → 720p → 480p)
  const sortedProfiles = [...nonUpscalingProfiles].sort((a, b) => b.height - a.height);

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

  // In the waterfall exactly one resolution is active at a time; report that one
  // (rather than every not-yet-finished profile) so `transcodingProfile` is truthful.
  let activeProfileName = toTranscode[0]?.name ?? sortedProfiles[0].name;

  const updateOverallProgress = () => {
    if (!onProgress) return;
    const sumProgress = sortedProfiles.reduce((acc, p) => acc + (profileProgressMap[p.name] ?? 0), 0);
    const overallPercent = Math.min(100, Math.round(sumProgress / totalProfilesCount));

    onProgress(overallPercent, activeProfileName);
  };

  // Initial progress update
  updateOverallProgress();

  const multiAudio = sourceInfo.audioTracks.length > 1;

  // Every audio rendition already complete? (avoids flashing the phase on resume)
  const audioRenditionsComplete = async (): Promise<boolean> => {
    if (!multiAudio) return true;
    for (let i = 0; i < sourceInfo.audioTracks.length; i++) {
      if (!(await isPlaylistComplete(path.join(finalDir, `audio_${i}`, 'playlist.m3u8')))) {
        return false;
      }
    }
    return true;
  };

  // ── Multi-audio: extract renditions AFTER video, never before ───────────────
  // Video encoding no longer blocks on audio. Multi-audio video variants are
  // video-only, so partial playback is served by the /hls master route's
  // on-demand extraction; once the video waterfall finishes here we extract all
  // renditions and rewrite master.m3u8 with the audio group.
  const extractAudioRenditions = async (): Promise<void> => {
    if (!multiAudio) return;
    if (await audioRenditionsComplete()) return;

    let sourceExists = true;
    try {
      await fs.access(inputPath);
    } catch {
      sourceExists = false;
    }
    if (!sourceExists) {
      logger.warn(`Audio renditions for ${movieId} are incomplete but the source is unavailable — skipping extraction`);
      return;
    }

    if (onProgress) {
      onProgress(100, EXTRACTING_AUDIO_PROFILE);
    }
    logger.info(
      `Video transcoding complete for ${movieId} — extracting ${sourceInfo.audioTracks.length} audio rendition(s)`,
    );

    await Promise.all(
      sourceInfo.audioTracks.map((track, index) =>
        ensureAudioTrackExtracted(
          movieId,
          inputPath,
          index,
          resolveSourceAudioIndex(track, index),
          hlsDirectory,
          ffmpegPath,
          segmentDuration,
        ).catch((err: unknown) => {
          logger.warn(
            `Audio rendition ${index} (${track.label}) extraction failed for ${movieId}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }),
      ),
    );
  };

  if (toTranscode.length === 0) {
    await extractAudioRenditions();
    await writeMasterPlaylist(finalDir, completedProfiles, sourceInfo.audioTracks);
    if (onProgress) {
      onProgress(100, sortedProfiles[0].name);
    }
    return;
  }

  // Determine worker thread module paths
  const isTs = path.extname(import.meta.url) === '.ts';
  const workerExt = isTs ? '.ts' : '.js';
  const workerUrl = new URL(`./transcodeWorker${workerExt}`, import.meta.url);
  const chunkWorkerUrl = new URL(`./transcodeChunkWorker${workerExt}`, import.meta.url);

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

  // ── Chunk pool sizing ────────────────────────────────────────────────────────
  const cpuCount = Math.max(1, os.cpus()?.length ?? 4);
  const requestedWorkers =
    chunkWorkers > 0 ? chunkWorkers : Math.max(1, Math.min(Math.floor(cpuCount / 2), 6));
  const workerCount = Math.max(1, Math.min(requestedWorkers, cpuCount));
  const threadsPerWorker = Math.max(1, Math.floor(cpuCount / workerCount));
  const videoOnly = sourceInfo.audioTracks.length > 1;

  // Legacy whole-file worker: one FFmpeg process transcodes the entire movie.
  const runMonolithicProfile = (profile: QualityProfile): Promise<void> => {
    const profileDir = path.join(finalDir, profile.name);
    return ensureDir(profileDir).then(
      () =>
        new Promise<void>((resolve, reject) => {
          if (signal?.aborted) {
            reject(new Error('Transcoding cancelled before start'));
            return;
          }

          const workerData: TranscodeWorkerData = {
            inputPath,
            outputDir: profileDir,
            profile,
            segmentDuration,
            ffmpegPath,
            durationSeconds: sourceInfo.durationSeconds,
            audioTracks: sourceInfo.audioTracks,
          };

          const worker = new Worker(workerUrl, {
            workerData,
            execArgv: process.execArgv,
          });
          activeWorkers.push(worker);

          let isDone = false;
          const cleanup = () => {
            const index = activeWorkers.indexOf(worker);
            if (index !== -1) activeWorkers.splice(index, 1);
            try {
              worker.terminate().catch(() => {});
            } catch {
              // ignore if already terminated
            }
          };

          worker.on('message', (msg: WorkerToMainMessage) => {
            if (msg.type === 'progress') {
              profileProgressMap[profile.name] = msg.percent;
              updateOverallProgress();
            } else if (msg.type === 'complete') {
              profileProgressMap[profile.name] = 100;
              updateOverallProgress();
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
        }),
    );
  };

  // Chunked worker pool: the profile is split into segment-aligned slices that
  // are encoded concurrently, then stitched with a single stream-copy concat.
  const runChunkedProfile = async (profile: QualityProfile): Promise<void> => {
    const profileDir = path.join(finalDir, profile.name);
    const chunkDir = path.join(profileDir, 'chunks');
    await ensureDir(chunkDir);

    const chunks = planTranscodeChunks({
      durationSeconds: sourceInfo.durationSeconds,
      chunkDurationSeconds,
      segmentDurationSeconds: segmentDuration,
    });

    if (chunks.length === 0) {
      // Unknown duration — cannot plan slices; use the whole-file worker instead.
      await runMonolithicProfile(profile);
      return;
    }

    // Clear stale HLS artifacts from a previous interrupted run (keeps chunks/).
    await cleanProfileHlsOutput(profileDir);

    const chunkFileName = (index: number) => `chunk_${String(index).padStart(4, '0')}.ts`;
    const doneMarker = (index: number) => `chunk_${String(index).padStart(4, '0')}.done`;

    const progressByIndex = new Map<number, number>();
    const pending: TranscodeChunk[] = [];

    for (const chunk of chunks) {
      const outPath = path.join(chunkDir, chunkFileName(chunk.index));
      const markerPath = path.join(chunkDir, doneMarker(chunk.index));
      if ((await fileExists(markerPath)) && (await fileExists(outPath))) {
        progressByIndex.set(chunk.index, 100);
      } else {
        await fs.rm(outPath, { force: true }).catch(() => {});
        await fs.rm(markerPath, { force: true }).catch(() => {});
        pending.push(chunk);
      }
    }

    const reportProfileProgress = () => {
      const percent = aggregateChunkProgress(chunks, progressByIndex);
      profileProgressMap[profile.name] = percent;
      updateOverallProgress();
    };

    reportProfileProgress();

    let poolAborted = false;
    let cursor = 0;

    const runSingleChunk = (chunk: TranscodeChunk): Promise<void> =>
      new Promise<void>((resolve, reject) => {
        const workerData: ChunkWorkerData = {
          inputPath,
          profile,
          segmentDuration,
          ffmpegPath,
          chunk: { index: chunk.index, startSec: chunk.startSec, durationSec: chunk.durationSec },
          outputPath: path.join(chunkDir, chunkFileName(chunk.index)),
          videoOnly,
          threads: threadsPerWorker,
        };

        const worker = new Worker(chunkWorkerUrl, {
          workerData,
          execArgv: process.execArgv,
        });
        activeWorkers.push(worker);

        let isDone = false;
        const cleanup = () => {
          const index = activeWorkers.indexOf(worker);
          if (index !== -1) activeWorkers.splice(index, 1);
          try {
            worker.terminate().catch(() => {});
          } catch {
            // ignore if already terminated
          }
        };

        worker.on('message', (msg: ChunkWorkerToMain) => {
          if (msg.type === 'progress') {
            progressByIndex.set(chunk.index, msg.percent);
            reportProfileProgress();
          } else if (msg.type === 'complete') {
            progressByIndex.set(chunk.index, 100);
            reportProfileProgress();
            const markerPath = path.join(chunkDir, doneMarker(chunk.index));
            fs.writeFile(markerPath, new Date().toISOString(), 'utf-8')
              .then(() => {
                if (!isDone) {
                  isDone = true;
                  cleanup();
                  resolve();
                }
              })
              .catch((err: unknown) => {
                if (!isDone) {
                  isDone = true;
                  cleanup();
                  reject(err instanceof Error ? err : new Error(String(err)));
                }
              });
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
            reject(new Error(`Chunk worker error for ${profile.name} #${chunk.index}: ${err.message}`));
          }
        });

        worker.on('exit', (code) => {
          if (!isDone) {
            isDone = true;
            cleanup();
            if (code === 0) {
              resolve();
            } else if (!signal?.aborted) {
              reject(new Error(`Chunk worker for ${profile.name} #${chunk.index} exited with code ${code}`));
            } else {
              reject(new Error('Transcoding was cancelled'));
            }
          }
        });
      });

    const runChunkLoop = async (): Promise<void> => {
      while (true) {
        const position = cursor++;
        if (position >= pending.length) return;
        if (poolAborted || signal?.aborted) return;
        try {
          await runSingleChunk(pending[position]);
        } catch (err) {
          poolAborted = true;
          throw err;
        }
      }
    };

    const poolSize = Math.max(1, Math.min(workerCount, pending.length));
    logger.info(
      `Chunked ${profile.name} for ${movieId}: ${chunks.length} chunk(s), ${pending.length} pending, ` +
        `${poolSize} worker(s), ${threadsPerWorker} thread(s) each`,
    );

    await Promise.all(Array.from({ length: poolSize }, () => runChunkLoop()));

    const chunkFiles = chunks.map((chunk) => chunkFileName(chunk.index));
    await stitchChunks({
      profileDir,
      chunkDir,
      chunkFiles,
      segmentDuration,
      ffmpegPath,
      videoOnly,
      signal,
    });
  };

  try {
    // Waterfall: one resolution at a time, highest quality first. Each profile
    // becomes playable (master.m3u8 updated) the moment its chunks are stitched.
    for (const profile of toTranscode) {
      if (signal?.aborted) {
        throw new Error('Transcoding cancelled');
      }

      activeProfileName = profile.name;
      const useChunking = chunked && sourceInfo.durationSeconds > 0;
      logger.info(
        `Transcoding ${profile.name} for ${movieId} ` +
          `(${useChunking ? `chunked, ${chunkDurationSeconds}s chunks` : 'whole-file'})`,
      );

      if (useChunking) {
        await runChunkedProfile(profile);
      } else {
        await runMonolithicProfile(profile);
      }

      profileProgressMap[profile.name] = 100;
      updateOverallProgress();

      if (!completedProfiles.some((p) => p.name === profile.name)) {
        completedProfiles.push(profile);
        completedProfiles.sort((a, b) => b.height - a.height);
        await writeMasterPlaylist(finalDir, completedProfiles, sourceInfo.audioTracks);
        logger.info(`master.m3u8 updated for ${movieId} — available: ${completedProfiles.map((p) => p.name).join(', ')}`);
        if (onProfileComplete) {
          onProfileComplete(profile, [...completedProfiles]);
        }
      }
    }

    // Video waterfall done. Deferred audio extraction + final master rewrite.
    await extractAudioRenditions();
    if (multiAudio) {
      await writeMasterPlaylist(finalDir, completedProfiles, sourceInfo.audioTracks);
    }

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
      audioTracks: sourceInfo.audioTracks.length > 0 ? sourceInfo.audioTracks : undefined,
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

async function writeMasterPlaylist(outputDir: string, profiles: QualityProfile[], audioTracks?: AudioTrackInfo[]): Promise<void> {
  const bandwidthMap: Record<string, number> = {
    '480p': 1400000,
    '720p': 2996000,
    '1080p': 5128000,
    '2160p': 16000000,
  };
  const resolutionMap: Record<string, string> = {
    '480p': '854x480',
    '720p': '1280x720',
    '1080p': '1920x1080',
    '2160p': '3840x2160',
  };

  const tracks = audioTracks ?? [];

  // Only advertise audio renditions that are COMPLETE (contain #EXT-X-ENDLIST).
  // Referencing a missing OR truncated alternate-audio playlist makes hls.js
  // stall in an endless buffering state when seeking past the extracted range.
  const availableAudio: number[] = [];
  for (let i = 0; i < tracks.length; i++) {
    if (await isPlaylistComplete(path.join(outputDir, `audio_${i}`, 'playlist.m3u8'))) {
      availableAudio.push(i);
    }
  }

  // Multi-audio video variants are video-only, so the audio group is required.
  const useAudioGroup = tracks.length > 1 && availableAudio.length >= 1;
  const audioGroupId = 'audio-tracks';

  // fMP4 media playlists require EXT-X-VERSION >= 7; muxed TS stays at 3.
  const masterVersion = tracks.length > 1 ? 7 : 3;
  let content = `#EXTM3U\n#EXT-X-VERSION:${masterVersion}\n\n`;

  if (useAudioGroup) {
    availableAudio.forEach((i, order) => {
      const track = tracks[i];
      const isDefault = order === 0 ? 'YES' : 'NO';
      const name = (track.label || `Track ${i + 1}`).replace(/"/g, "'");
      const lang = track.language || 'und';
      content += `#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="${audioGroupId}",NAME="${name}",LANGUAGE="${lang}",DEFAULT=${isDefault},AUTOSELECT=${isDefault},URI="audio_${i}/playlist.m3u8"\n`;
    });
    content += '\n';
  }

  for (const profile of profiles) {
    const bandwidth = bandwidthMap[profile.name] ?? 2000000;
    const resolution = resolutionMap[profile.name] ?? `${profile.width}x${profile.height}`;
    const audioAttr = useAudioGroup ? `,AUDIO="${audioGroupId}"` : '';
    content += `#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth},RESOLUTION=${resolution},CODECS="avc1.42e01e,mp4a.40.2"${audioAttr}\n`;
    content += `${profile.name}/playlist.m3u8\n\n`;
  }

  await fs.writeFile(path.join(outputDir, 'master.m3u8'), content, 'utf-8');
}

