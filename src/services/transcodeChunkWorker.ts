import { parentPort, workerData } from 'worker_threads';
import { spawn, ChildProcess } from 'child_process';
import { QualityProfile } from '../types/movie.js';

/**
 * Worker thread that encodes a single time slice of a movie into an intermediate
 * MPEG-TS file. Chunks are independently encoded and later stitched by
 * `chunkStitcher.ts` with a single stream-copy concat (Option B in
 * CHUNK_TRANSCODING_PLAN.md).
 *
 * Intermediate output is intentionally MPEG-TS: it concatenates losslessly with
 * `-c copy`, keeps per-chunk timestamps self-contained, and lets the stitcher
 * emit either mpegts (single-audio) or fMP4 (multi-audio) HLS from one pass.
 */

export interface ChunkWorkerData {
  inputPath: string;
  profile: QualityProfile;
  segmentDuration: number;
  ffmpegPath: string;
  /** The slice of the timeline this worker encodes. */
  chunk: { index: number; startSec: number; durationSec: number };
  /** Absolute path of the intermediate `.ts` file to write. */
  outputPath: string;
  /** True when audio is carried by separate renditions (multi-audio sources). */
  videoOnly: boolean;
  /** FFmpeg `-threads` value for this worker (<= 0 omits the flag). */
  threads: number;
}

export type ChunkWorkerToMain =
  | { type: 'progress'; chunkIndex: number; percent: number }
  | { type: 'complete'; chunkIndex: number }
  | { type: 'error'; chunkIndex: number; error: string };

export type MainToChunkWorker = { type: 'cancel' };

if (!parentPort) {
  throw new Error('transcodeChunkWorker must be spawned as a Worker thread');
}

const data = workerData as ChunkWorkerData;

let proc: ChildProcess | null = null;
let isCancelled = false;

parentPort.on('message', (msg: MainToChunkWorker) => {
  if (msg.type === 'cancel') {
    isCancelled = true;
    if (proc) {
      proc.kill('SIGTERM');
    }
  }
});

function runFfmpeg(args: string[], ffmpegPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (isCancelled) {
      reject(new Error('Chunk transcode cancelled before start'));
      return;
    }

    proc = spawn(ffmpegPath, args, { stdio: 'pipe' });

    let stderrOutput = '';
    let stderrBuffer = '';

    proc.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      stderrOutput += text;
      stderrBuffer += text;

      const lines = stderrBuffer.split('\n');
      stderrBuffer = lines.pop() ?? '';

      for (const line of lines) {
        const usMatch = line.match(/^out_time_us=(\d+)/);
        if (usMatch && data.chunk.durationSec > 0) {
          const elapsedSec = parseInt(usMatch[1], 10) / 1_000_000;
          const pct = Math.min(99, Math.round((elapsedSec / data.chunk.durationSec) * 100));
          parentPort?.postMessage({ type: 'progress', chunkIndex: data.chunk.index, percent: pct });
          continue;
        }

        const timeMatch = line.match(/time=(\d+):(\d+):(\d+\.\d+)/);
        if (timeMatch && data.chunk.durationSec > 0) {
          const elapsed =
            parseInt(timeMatch[1], 10) * 3600 +
            parseInt(timeMatch[2], 10) * 60 +
            parseFloat(timeMatch[3]);
          const pct = Math.min(99, Math.round((elapsed / data.chunk.durationSec) * 100));
          parentPort?.postMessage({ type: 'progress', chunkIndex: data.chunk.index, percent: pct });
        }
      }
    });

    proc.on('error', (err) => {
      reject(new Error(`FFmpeg process error: ${err.message}`));
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else if (isCancelled) {
        reject(new Error('Chunk transcode was cancelled'));
      } else {
        const lastLines = stderrOutput.split('\n').slice(-20).join('\n');
        reject(new Error(`FFmpeg exited with code ${code}.\n${lastLines}`));
      }
    });
  });
}

async function runWorker(): Promise<void> {
  const { inputPath, profile, segmentDuration, ffmpegPath, chunk, outputPath, videoOnly, threads } = data;

  const scaleFilter =
    `scale=${profile.width}:${profile.height}:` +
    `force_original_aspect_ratio=decrease,` +
    `pad=${profile.width}:${profile.height}:(ow-iw)/2:(oh-ih)/2,` +
    `format=yuv420p`;

  const args: string[] = [
    '-y',
    '-ss', String(chunk.startSec),
    '-t', String(chunk.durationSec),
    '-accurate_seek',
    '-i', inputPath,
    '-map', '0:v:0',
  ];

  if (!videoOnly) {
    args.push('-map', '0:a:0?');
  }

  args.push(
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '23',
    '-maxrate', profile.videoBitrate,
    '-bufsize', `${parseInt(profile.videoBitrate, 10) * 2}k`,
    '-vf', scaleFilter,
    '-force_key_frames', `expr:gte(t,n_forced*${segmentDuration})`,
    '-sc_threshold', '0',
  );

  if (threads > 0) {
    args.push('-threads', String(threads));
  }

  if (videoOnly) {
    args.push('-an');
  } else {
    args.push('-c:a', 'aac', '-b:a', profile.audioBitrate, '-ac', '2');
  }

  args.push(
    '-f', 'mpegts',
    '-progress', 'pipe:2',
    '-nostats',
    outputPath,
  );

  await runFfmpeg(args, ffmpegPath);

  parentPort?.postMessage({ type: 'progress', chunkIndex: chunk.index, percent: 100 });
  parentPort?.postMessage({ type: 'complete', chunkIndex: chunk.index });
  setTimeout(() => {
    process.exit(0);
  }, 50);
}

runWorker().catch((err: Error) => {
  parentPort?.postMessage({
    type: 'error',
    chunkIndex: data.chunk.index,
    error: err.message,
  });
  process.exit(1);
});
