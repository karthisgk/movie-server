import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs/promises';
import { fileExists } from '../utils/filesystem.js';
import { logger } from '../utils/logger.js';
import { Movie } from '../types/movie.js';

const activeAudioJobs = new Map<string, Promise<void>>();

/**
 * A media playlist is only complete once FFmpeg has written `#EXT-X-ENDLIST`.
 * While an extraction is interrupted (server restart, killed process, …) the
 * playlist exists but is truncated — treating that as "done" is what left movies
 * with only a few minutes of audio and made seeking stall forever.
 */
export async function isPlaylistComplete(playlistFile: string): Promise<boolean> {
  try {
    const content = await fs.readFile(playlistFile, 'utf-8');
    return content.includes('#EXT-X-ENDLIST');
  } catch {
    return false;
  }
}

/** Returns the audio track indices whose rendition exists AND is complete. */
export async function existingAudioTrackIndices(
  movieId: string,
  hlsDirectory: string,
  audioTracks: unknown[] | undefined,
): Promise<number[]> {
  const count = Array.isArray(audioTracks) ? audioTracks.length : 0;
  const indices: number[] = [];
  for (let i = 0; i < count; i++) {
    const playlist = path.join(hlsDirectory, movieId, `audio_${i}`, 'playlist.m3u8');
    if (await isPlaylistComplete(playlist)) {
      indices.push(i);
    }
  }
  return indices;
}

/**
 * Ensures the HLS audio rendition for a track is fully extracted to
 * `hlsDirectory/<movieId>/audio_<trackIndex>/`.
 *
 * - Fragmented MP4 (CMAF) so it shares the container model with the video
 *   variants and hls.js remuxes it natively (keeps seeking aligned).
 * - Resolves only when extraction FINISHES (or fails); a playlist without
 *   `#EXT-X-ENDLIST` is considered incomplete and is re-extracted from scratch.
 * - Concurrent callers share a single in-flight job.
 */
export async function ensureAudioTrackExtracted(
  movieId: string,
  sourcePath: string,
  trackIndex: number,
  hlsDirectory: string,
  ffmpegPath: string,
  segmentDuration = 6,
): Promise<void> {
  const jobKey = `${movieId}-${trackIndex}`;

  const inFlight = activeAudioJobs.get(jobKey);
  if (inFlight) {
    return inFlight;
  }

  const audioDir = path.join(hlsDirectory, movieId, `audio_${trackIndex}`);
  const playlistFile = path.join(audioDir, 'playlist.m3u8');

  const jobPromise = (async () => {
    // Already fully extracted — nothing to do.
    if (await isPlaylistComplete(playlistFile)) {
      return;
    }

    // Never destroy a partial rendition we cannot rebuild (source gone).
    try {
      await fs.access(sourcePath);
    } catch {
      logger.warn(`Audio rendition for "${movieId}" track ${trackIndex} is incomplete but the source is unavailable — leaving as-is`);
      return;
    }

    try {
      // Remove any partial/stale output so the re-extraction starts clean.
      if (await fileExists(playlistFile)) {
        logger.warn(`Audio rendition for "${movieId}" track ${trackIndex} is incomplete — re-extracting`);
        await fs.rm(audioDir, { recursive: true, force: true });
      }
      await fs.mkdir(audioDir, { recursive: true });
      logger.info(`Starting HLS audio extraction for "${movieId}" (audio track index: ${trackIndex})`);

      const args = [
        '-y',
        '-i', sourcePath,
        '-map', `0:a:${trackIndex}`,
        '-vn',
        '-c:a', 'aac',
        '-b:a', '128k',
        '-ac', '2',
        '-f', 'hls',
        '-hls_time', String(segmentDuration),
        '-hls_list_size', '0',
        '-hls_segment_type', 'fmp4',
        '-hls_fmp4_init_filename', 'init.mp4',
        '-hls_segment_filename', 'segment_%03d.m4s',
        '-hls_flags', 'independent_segments',
        'playlist.m3u8',
      ];

      // cwd = audioDir so init.mp4 lands next to playlist.m3u8 (FFmpeg resolves
      // the relative init/segment filenames against the CWD, not the playlist).
      await new Promise<void>((resolve) => {
        const proc = spawn(ffmpegPath, args, { stdio: 'pipe', cwd: audioDir });

        let stderrOutput = '';
        proc.stderr?.on('data', (d: Buffer) => {
          stderrOutput += d.toString();
        });

        proc.on('error', (err) => {
          logger.error(`Failed to spawn FFmpeg for audio extraction: ${err.message}`);
          resolve();
        });

        proc.on('close', (code) => {
          if (code === 0) {
            logger.info(`Completed HLS audio extraction for "${movieId}" (track ${trackIndex})`);
          } else {
            logger.error(
              `FFmpeg audio extraction failed for "${movieId}" track ${trackIndex} (exit code ${code}):\n${stderrOutput.slice(-500)}`,
            );
          }
          resolve();
        });
      });
    } finally {
      activeAudioJobs.delete(jobKey);
    }
  })();

  activeAudioJobs.set(jobKey, jobPromise);
  return jobPromise;
}

/**
 * Repairs movies whose audio renditions were left truncated by an interrupted
 * extraction (e.g. a server restart). Runs in the background: each affected
 * movie has its audio tracks rebuilt to completion before it is served again.
 */
export async function repairIncompleteAudioRenditions(
  movies: { id: string; sourcePath?: string; audioTracks?: unknown[] }[],
  hlsDirectory: string,
  ffmpegPath: string,
  segmentDuration = 6,
  concurrency = 2,
): Promise<void> {
  const candidates = movies.filter(
    (m) => m.sourcePath && Array.isArray(m.audioTracks) && m.audioTracks.length > 1,
  );
  if (candidates.length === 0) return;

  let cursor = 0;
  const worker = async () => {
    while (cursor < candidates.length) {
      const movie = candidates[cursor++];
      if (!movie.sourcePath) continue;
      try {
        // Reuse the same dedupe/self-heal path; sequential per movie is handled
        // inside by running all tracks in parallel.
        await Promise.all(
          (movie.audioTracks as unknown[]).map((_t, index) =>
            ensureAudioTrackExtracted(movie.id, movie.sourcePath as string, index, hlsDirectory, ffmpegPath, segmentDuration).catch(
              (err: unknown) => {
                logger.warn(`Audio repair failed for ${movie.id} track ${index}: ${err}`);
              },
            ),
          ),
        );
      } catch (err) {
        logger.warn(`Audio repair failed for ${movie.id}: ${err}`);
      }
    }
  };

  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, candidates.length)) }, worker));
}

/**
 * Dynamically generates a master.m3u8 playlist string for a movie,
 * wiring #EXT-X-MEDIA:TYPE=AUDIO groups for all detected audio tracks.
 *
 * Only COMPLETE renditions are advertised — referencing a missing or truncated
 * alternate-audio playlist makes hls.js stall in an endless buffering state.
 */
export async function generateMasterPlaylistContent(
  movieId: string,
  hlsDirectory: string,
  movie: Movie,
): Promise<string> {
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

  const movieDir = path.join(hlsDirectory, movieId);
  const profiles = ['2160p', '1080p', '720p', '480p'];
  const availableProfiles: string[] = [];

  for (const p of profiles) {
    if (await fileExists(path.join(movieDir, p, 'playlist.m3u8'))) {
      availableProfiles.push(p);
    }
  }

  // Fallback to all completed profiles or whatever exists
  if (availableProfiles.length === 0 && movie.completedProfiles) {
    availableProfiles.push(...movie.completedProfiles);
  }

  const audioTracks = movie.audioTracks || [];
  const availableAudio = await existingAudioTrackIndices(movieId, hlsDirectory, audioTracks);
  const useAudioGroup = audioTracks.length > 1 && availableAudio.length >= 1;
  const audioGroupId = 'audio-tracks';

  // fMP4 media playlists require EXT-X-VERSION >= 7.
  const masterVersion = audioTracks.length > 1 ? 7 : 3;
  let content = `#EXTM3U\n#EXT-X-VERSION:${masterVersion}\n\n`;

  if (useAudioGroup) {
    availableAudio.forEach((i, order) => {
      const track = audioTracks[i];
      const isDefault = order === 0 ? 'YES' : 'NO';
      const name = (track.label || `Track ${i + 1}`).replace(/"/g, "'");
      const lang = track.language || 'und';
      content += `#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="${audioGroupId}",NAME="${name}",LANGUAGE="${lang}",DEFAULT=${isDefault},AUTOSELECT=${isDefault},URI="audio_${i}/playlist.m3u8"\n`;
    });
    content += '\n';
  }

  for (const profileName of availableProfiles) {
    const bandwidth = bandwidthMap[profileName] ?? 2000000;
    const resolution = resolutionMap[profileName] ?? '1920x1080';
    const audioAttr = useAudioGroup ? `,AUDIO="${audioGroupId}"` : '';
    content += `#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth},RESOLUTION=${resolution},CODECS="avc1.42e01e,mp4a.40.2"${audioAttr}\n`;
    content += `${profileName}/playlist.m3u8\n\n`;
  }

  return content;
}
