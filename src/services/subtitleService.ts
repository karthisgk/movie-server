import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { logger } from '../utils/logger.js';
import { ensureDir } from '../utils/filesystem.js';

export interface SubtitleTrack {
  index: number;        // Stream index within the source file
  trackIndex: number;   // Sequential subtitle track number (0-based)
  language: string;     // ISO 639-2 language code (e.g. 'eng', 'fre') or 'und'
  label: string;        // Human-readable label (e.g. 'English', 'French')
  url: string;          // Relative URL to the .vtt file
}

export interface SubtitleExtractionResult {
  tracks: SubtitleTrack[];
  outputDir: string;
}

interface FfprobeSubtitleStream {
  index: number;
  codec_type: string;
  codec_name: string;
  tags?: {
    language?: string;
    title?: string;
    LANGUAGE?: string;
    TITLE?: string;
  };
}

interface FfprobeSubtitleOutput {
  streams: FfprobeSubtitleStream[];
}

/** Language code → human-readable name map for common languages */
const LANGUAGE_NAMES: Record<string, string> = {
  eng: 'English',
  fre: 'French',
  fra: 'French',
  ger: 'German',
  deu: 'German',
  spa: 'Spanish',
  ita: 'Italian',
  jpn: 'Japanese',
  chi: 'Chinese',
  zho: 'Chinese',
  kor: 'Korean',
  por: 'Portuguese',
  rus: 'Russian',
  ara: 'Arabic',
  hin: 'Hindi',
  tam: 'Tamil',
  tel: 'Telugu',
  mal: 'Malayalam',
  kan: 'Kannada',
  ben: 'Bengali',
  und: 'Unknown',
};

function getLanguageLabel(lang: string, title?: string): string {
  if (title && title.trim()) return title.trim();
  const normalized = lang.toLowerCase().trim();
  return LANGUAGE_NAMES[normalized] ?? lang.toUpperCase();
}

/**
 * Probes a source file and returns all subtitle stream metadata.
 * Returns an empty array if there are no subtitle streams or probe fails.
 */
async function probeSubtitleStreams(
  inputPath: string,
  ffprobePath: string,
): Promise<FfprobeSubtitleStream[]> {
  return new Promise((resolve) => {
    const args = [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_streams',
      '-select_streams', 's',
      inputPath,
    ];

    const proc = spawn(ffprobePath, args, { stdio: 'pipe' });
    let stdout = '';

    proc.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    proc.on('error', () => resolve([]));

    proc.on('close', (code) => {
      if (code !== 0 || !stdout.trim()) {
        resolve([]);
        return;
      }
      try {
        const parsed = JSON.parse(stdout) as FfprobeSubtitleOutput;
        resolve(parsed.streams ?? []);
      } catch {
        resolve([]);
      }
    });
  });
}

/**
 * Extracts a single subtitle stream from the source file to a .vtt file using FFmpeg.
 * Uses -map 0:s:<trackIndex> to select the right subtitle stream.
 */
function extractSubtitleTrack(
  inputPath: string,
  outputPath: string,
  trackIndex: number,
  ffmpegPath: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = [
      '-i', inputPath,
      '-map', `0:s:${trackIndex}`,
      '-c:s', 'webvtt',
      '-y',               // overwrite if exists
      outputPath,
    ];

    const proc = spawn(ffmpegPath, args, { stdio: 'pipe' });
    let stderr = '';

    proc.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on('error', (err) => {
      reject(new Error(`FFmpeg process error during subtitle extraction: ${err.message}`));
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        const tail = stderr.split('\n').slice(-10).join('\n');
        reject(new Error(`FFmpeg subtitle extraction exited with code ${code}.\n${tail}`));
      }
    });
  });
}

/**
 * Extracts all subtitle tracks from a source file into .vtt files stored under:
 *   <hlsDirectory>/<movieId>/subtitles/sub_<trackIndex>_<lang>.vtt
 *
 * Returns the list of subtitle tracks with their metadata and relative URLs.
 * Returns an empty tracks array if the source file has no subtitle streams.
 * Never throws — failures are logged and the track is skipped.
 */
export async function extractSubtitles(
  movieId: string,
  sourcePath: string,
  hlsDirectory: string,
  ffmpegPath: string,
  ffprobePath: string,
): Promise<SubtitleExtractionResult> {
  const outputDir = path.join(hlsDirectory, movieId, 'subtitles');
  const tracks: SubtitleTrack[] = [];

  // Probe subtitle streams
  let streams: FfprobeSubtitleStream[];
  try {
    streams = await probeSubtitleStreams(sourcePath, ffprobePath);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(`[subtitleService] Failed to probe subtitles for ${movieId}: ${msg}`);
    return { tracks, outputDir };
  }

  if (streams.length === 0) {
    logger.info(`[subtitleService] No subtitle streams found in ${movieId}`);
    return { tracks, outputDir };
  }

  logger.info(`[subtitleService] Found ${streams.length} subtitle stream(s) in ${movieId}`);

  // Ensure output directory exists
  try {
    await ensureDir(outputDir);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[subtitleService] Cannot create subtitles directory for ${movieId}: ${msg}`);
    return { tracks, outputDir };
  }

  // Extract each subtitle stream
  for (let trackIndex = 0; trackIndex < streams.length; trackIndex++) {
    const stream = streams[trackIndex]!;
    const lang = (stream.tags?.language ?? stream.tags?.LANGUAGE ?? 'und').toLowerCase();
    const title = stream.tags?.title ?? stream.tags?.TITLE;
    const label = getLanguageLabel(lang, title);
    const filename = `sub_${trackIndex}_${lang}.vtt`;
    const outputPath = path.join(outputDir, filename);
    const url = `/hls/${movieId}/subtitles/${filename}`;

    try {
      await extractSubtitleTrack(sourcePath, outputPath, trackIndex, ffmpegPath);
      logger.info(`[subtitleService] Extracted subtitle track ${trackIndex} (${lang}) for ${movieId}`);
      tracks.push({
        index: stream.index,
        trackIndex,
        language: lang,
        label,
        url,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(`[subtitleService] Failed to extract subtitle track ${trackIndex} for ${movieId}: ${msg}`);
      // Skip this track but continue with others
    }
  }

  logger.info(`[subtitleService] Subtitle extraction done for ${movieId}: ${tracks.length}/${streams.length} tracks extracted`);
  return { tracks, outputDir };
}

/**
 * Lists all previously extracted subtitle tracks for a movie by reading
 * the subtitles directory. Returns an empty array if none exist.
 */
export async function listExtractedSubtitles(
  movieId: string,
  hlsDirectory: string,
): Promise<SubtitleTrack[]> {
  const subtitleDir = path.join(hlsDirectory, movieId, 'subtitles');

  let files: string[];
  try {
    files = await fs.readdir(subtitleDir);
  } catch {
    // Directory doesn't exist — no subtitles extracted yet
    return [];
  }

  const tracks: SubtitleTrack[] = [];

  for (const file of files.filter((f) => f.endsWith('.vtt'))) {
    // Filename format: sub_<trackIndex>_<lang>.vtt
    const match = file.match(/^sub_(\d+)_([a-z]+)\.vtt$/);
    if (!match) continue;

    const trackIndex = parseInt(match[1]!, 10);
    const lang = match[2]!;
    const label = getLanguageLabel(lang);

    tracks.push({
      index: trackIndex,   // We don't store the original stream index; re-use trackIndex
      trackIndex,
      language: lang,
      label,
      url: `/hls/${movieId}/subtitles/${file}`,
    });
  }

  // Sort by trackIndex
  tracks.sort((a, b) => a.trackIndex - b.trackIndex);
  return tracks;
}
