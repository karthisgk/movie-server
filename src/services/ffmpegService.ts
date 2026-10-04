import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { AudioTrackInfo, FfprobeOutput, QUALITY_PROFILES, QualityProfile } from '../types/movie.js';
import { ensureDir, writeJsonFile } from '../utils/filesystem.js';
import { logger } from '../utils/logger.js';
import { HlsMetadata } from '../types/movie.js';
import { ensureAudioTrackExtracted, isPlaylistComplete } from './audioExtractionService.js';

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

  // Build audio track info for every audio stream
  const audioTracks: AudioTrackInfo[] = audioStreams.map((s, idx) => {
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
      language: lang,
      label,
      codec: s.codec_name,
      channels,
    };
  });

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

  // ── Multi-audio: materialise every audio rendition up-front ─────────────────
  // Multi-audio video variants are video-only, so each audio track MUST exist as
  // its own rendition before any master.m3u8 references it. Doing this once here
  // (including for already-completed movies) prevents the master from pointing at
  // an audio playlist that does not exist — which makes hls.js buffer forever.
  if (sourceInfo.audioTracks.length > 1) {
    let sourceExists = true;
    try {
      await fs.access(inputPath);
    } catch {
      sourceExists = false;
    }

    if (sourceExists) {
      await Promise.all(
        sourceInfo.audioTracks.map((_track, index) =>
          ensureAudioTrackExtracted(movieId, inputPath, index, hlsDirectory, ffmpegPath, segmentDuration).catch(
            (err: unknown) => {
              logger.warn(
                `Audio track ${index} extraction failed for ${movieId}: ${err instanceof Error ? err.message : String(err)}`,
              );
            },
          ),
        ),
      );
    }
  }

  if (toTranscode.length === 0) {
    await writeMasterPlaylist(finalDir, completedProfiles, sourceInfo.audioTracks);
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
        audioTracks: sourceInfo.audioTracks,
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
              await writeMasterPlaylist(finalDir, completedProfiles, sourceInfo.audioTracks);
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

