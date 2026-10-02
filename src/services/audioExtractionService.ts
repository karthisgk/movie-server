import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs/promises';
import { fileExists } from '../utils/filesystem.js';
import { logger } from '../utils/logger.js';
import { Movie, QualityProfile } from '../types/movie.js';

const activeAudioJobs = new Map<string, Promise<void>>();

/**
 * Ensures that the HLS audio playlist and segments for a specific audio track
 * are extracted to `hlsDirectory/<movieId>/audio_<trackIndex>/`.
 *
 * Spawns an on-demand ffmpeg process if not already extracted or in progress,
 * and waits until `playlist.m3u8` exists so the HTTP request can respond immediately.
 */
export async function ensureAudioTrackExtracted(
  movieId: string,
  sourcePath: string,
  trackIndex: number,
  hlsDirectory: string,
  ffmpegPath: string,
): Promise<void> {
  const audioDir = path.join(hlsDirectory, movieId, `audio_${trackIndex}`);
  const playlistFile = path.join(audioDir, 'playlist.m3u8');

  // If already extracted, return immediately
  if (await fileExists(playlistFile)) {
    return;
  }

  const jobKey = `${movieId}-${trackIndex}`;
  if (activeAudioJobs.has(jobKey)) {
    await activeAudioJobs.get(jobKey);
    return;
  }

  const jobPromise = (async () => {
    try {
      await fs.mkdir(audioDir, { recursive: true });
      logger.info(`Starting on-demand HLS audio extraction for "${movieId}" (audio track index: ${trackIndex})`);

      const args = [
        '-y',
        '-i', sourcePath,
        '-map', `0:a:${trackIndex}`,
        '-vn',
        '-c:a', 'aac',
        '-b:a', '128k',
        '-ac', '2',
        '-f', 'hls',
        '-hls_time', '6',
        '-hls_list_size', '0',
        '-hls_segment_type', 'mpegts',
        '-hls_segment_filename', path.join(audioDir, 'segment_%03d.ts'),
        playlistFile,
      ];

      const proc = spawn(ffmpegPath, args, { stdio: 'pipe' });

      let stderrOutput = '';
      proc.stderr?.on('data', (d: Buffer) => {
        stderrOutput += d.toString();
      });

      proc.on('close', (code) => {
        if (code === 0) {
          logger.info(`Completed HLS audio extraction for "${movieId}" (track ${trackIndex})`);
        } else {
          logger.error(`FFmpeg audio extraction failed for "${movieId}" track ${trackIndex} (exit code ${code}):\n${stderrOutput.slice(-500)}`);
        }
        activeAudioJobs.delete(jobKey);
      });

      proc.on('error', (err) => {
        logger.error(`Failed to spawn FFmpeg for audio extraction: ${err.message}`);
        activeAudioJobs.delete(jobKey);
      });

      // Poll until playlist.m3u8 is created (usually within 300-500ms)
      const start = Date.now();
      while (Date.now() - start < 15000) {
        if (await fileExists(playlistFile)) {
          logger.info(`Audio playlist is ready for "${movieId}" track ${trackIndex} in ${Date.now() - start}ms`);
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    } catch (err) {
      activeAudioJobs.delete(jobKey);
      throw err;
    }
  })();

  activeAudioJobs.set(jobKey, jobPromise);
  await jobPromise;
}

/**
 * Dynamically generates a master.m3u8 playlist string for a movie,
 * wiring #EXT-X-MEDIA:TYPE=AUDIO groups for all detected audio tracks.
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
  };
  const resolutionMap: Record<string, string> = {
    '480p': '854x480',
    '720p': '1280x720',
    '1080p': '1920x1080',
  };

  const movieDir = path.join(hlsDirectory, movieId);
  const profiles = ['1080p', '720p', '480p'];
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
  const hasMultipleAudio = audioTracks.length > 1;
  const audioGroupId = 'audio-tracks';

  let content = '#EXTM3U\n#EXT-X-VERSION:3\n\n';

  if (hasMultipleAudio) {
    for (let i = 0; i < audioTracks.length; i++) {
      const track = audioTracks[i];
      const isDefault = i === 0 ? 'YES' : 'NO';
      const name = (track.label || `Track ${i + 1}`).replace(/"/g, "'");
      const lang = track.language || 'und';
      content += `#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="${audioGroupId}",NAME="${name}",LANGUAGE="${lang}",DEFAULT=${isDefault},AUTOSELECT=${isDefault},URI="audio_${i}/playlist.m3u8"\n`;
    }
    content += '\n';
  }

  for (const profileName of availableProfiles) {
    const bandwidth = bandwidthMap[profileName] ?? 2000000;
    const resolution = resolutionMap[profileName] ?? '1920x1080';
    const audioAttr = hasMultipleAudio ? `,AUDIO="${audioGroupId}"` : '';
    content += `#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth},RESOLUTION=${resolution},CODECS="avc1.42e01e,mp4a.40.2"${audioAttr}\n`;
    content += `${profileName}/playlist.m3u8\n\n`;
  }

  return content;
}
