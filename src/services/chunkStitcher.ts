import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { logger } from '../utils/logger.js';

export interface StitchOptions {
  /** Final HLS output dir for the profile (playlist.m3u8 + segments live here). */
  profileDir: string;
  /** Directory holding the intermediate `chunk_XXXX.ts` files. */
  chunkDir: string;
  /** Ordered chunk file basenames (e.g. ['chunk_0000.ts', ...]). */
  chunkFiles: string[];
  segmentDuration: number;
  ffmpegPath: string;
  /** Multi-audio sources emit a video-only fMP4 variant; single-audio stays muxed TS. */
  videoOnly: boolean;
  signal?: AbortSignal;
}

/**
 * Stitches independently-encoded chunk files into the final HLS rendition with a
 * single stream-copy (`-c copy`) concat pass.
 *
 * Why stream-copy concat rather than writing segments directly from each worker
 * (Option A in the plan): direct per-chunk segment output leaves ~80 ms PTS
 * discontinuities at chunk boundaries, which produces non-monotonic DTS warnings
 * and can glitch strict players. A single concat remux re-times every stream onto
 * one continuous timeline, so segments land on exact `segmentDuration` boundaries.
 */
export async function stitchChunks(options: StitchOptions): Promise<void> {
  const { profileDir, chunkDir, chunkFiles, segmentDuration, ffmpegPath, videoOnly, signal } = options;

  if (chunkFiles.length === 0) {
    throw new Error('Cannot stitch HLS: no chunk files were produced');
  }

  await fs.mkdir(profileDir, { recursive: true });

  // Drop any stale HLS output from a previous interrupted run (but keep chunks/).
  await cleanProfileHlsOutput(profileDir);

  // The concat list lives beside the chunks; relative entries resolve against it.
  const listPath = path.join(chunkDir, 'concat.txt');
  const listContent = chunkFiles.map((name) => `file '${name}'`).join('\n') + '\n';
  await fs.writeFile(listPath, listContent, 'ascii');

  const args = [
    '-y',
    '-f', 'concat',
    '-safe', '0',
    '-i', listPath,
    '-c', 'copy',
    '-map', '0',
    '-f', 'hls',
    '-hls_time', String(segmentDuration),
    '-hls_list_size', '0',
    '-hls_flags', 'independent_segments',
  ];

  if (videoOnly) {
    args.push(
      '-hls_segment_type', 'fmp4',
      '-hls_fmp4_init_filename', 'init.mp4',
      '-hls_segment_filename', 'segment_%03d.m4s',
    );
  } else {
    args.push(
      '-hls_segment_type', 'mpegts',
      '-hls_segment_filename', 'segment_%03d.ts',
    );
  }

  args.push('playlist.m3u8');

  await runFfmpeg(args, ffmpegPath, profileDir, signal);

  const playlistPath = path.join(profileDir, 'playlist.m3u8');
  const content = await fs.readFile(playlistPath, 'utf-8').catch(() => '');
  if (!content.includes('#EXT-X-ENDLIST')) {
    throw new Error('Stitched playlist is incomplete (missing #EXT-X-ENDLIST)');
  }

  // Chunks are no longer needed once the final playlist is complete.
  await fs.rm(chunkDir, { recursive: true, force: true });
  logger.info(`Stitched ${chunkFiles.length} chunk(s) → ${path.join(profileDir, 'playlist.m3u8')}`);
}

/**
 * Removes final HLS artifacts (playlist, init, segments) while preserving the
 * nested `chunks/` directory so a resumed run can reuse completed chunks.
 */
export async function cleanProfileHlsOutput(profileDir: string): Promise<void> {
  let entries: string[];
  try {
    entries = await fs.readdir(profileDir);
  } catch {
    return;
  }

  for (const name of entries) {
    if (name === 'chunks') continue;
    if (name === 'playlist.m3u8' || name === 'init.mp4' || /^segment_\d+\.(ts|m4s)$/.test(name)) {
      await fs.rm(path.join(profileDir, name), { force: true }).catch(() => {});
    }
  }
}

function runFfmpeg(args: string[], ffmpegPath: string, cwd: string, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('Stitching cancelled before start'));
      return;
    }

    const proc = spawn(ffmpegPath, args, { stdio: 'pipe', cwd });

    let stderrOutput = '';
    proc.stderr?.on('data', (d: Buffer) => {
      stderrOutput += d.toString();
    });

    const onAbort = () => {
      proc.kill('SIGTERM');
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    const cleanup = () => signal?.removeEventListener('abort', onAbort);

    proc.on('error', (err) => {
      cleanup();
      reject(new Error(`FFmpeg stitch process error: ${err.message}`));
    });

    proc.on('close', (code) => {
      cleanup();
      if (code === 0) {
        resolve();
      } else if (signal?.aborted) {
        reject(new Error('Stitching was cancelled'));
      } else {
        const lastLines = stderrOutput.split('\n').slice(-20).join('\n');
        reject(new Error(`FFmpeg stitch exited with code ${code}.\n${lastLines}`));
      }
    });
  });
}
