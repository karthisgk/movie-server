import { parentPort, workerData } from 'worker_threads';
import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs/promises';
import { AudioTrackInfo, QualityProfile } from '../types/movie.js';

export interface TranscodeWorkerData {
  inputPath: string;
  outputDir: string;
  profile: QualityProfile;
  segmentDuration: number;
  ffmpegPath: string;
  durationSeconds: number;
  /** All audio tracks from the source file (for multi-audio HLS output) */
  audioTracks?: AudioTrackInfo[];
}

export type WorkerToMainMessage =
  | { type: 'progress'; profileName: string; percent: number }
  | { type: 'complete'; profileName: string }
  | { type: 'error'; profileName: string; error: string };

export type MainToWorkerMessage = { type: 'cancel' };

if (!parentPort) {
  throw new Error('transcodeWorker must be spawned as a Worker thread');
}

const data = workerData as TranscodeWorkerData;

let proc: ChildProcess | null = null;
let isCancelled = false;

parentPort.on('message', (msg: MainToWorkerMessage) => {
  if (msg.type === 'cancel') {
    isCancelled = true;
    if (proc) {
      proc.kill('SIGTERM');
    }
  }
});

function runFfmpeg(args: string[], ffmpegPath: string, durationSeconds: number, profileName: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (isCancelled) {
      reject(new Error('Transcoding cancelled before start'));
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
        if (usMatch && durationSeconds > 0) {
          const elapsedSec = parseInt(usMatch[1], 10) / 1_000_000;
          const pct = Math.min(99, Math.round((elapsedSec / durationSeconds) * 100));
          parentPort?.postMessage({ type: 'progress', profileName, percent: pct });
          continue;
        }

        const timeMatch = line.match(/time=(\d+):(\d+):(\d+\.\d+)/);
        if (timeMatch && durationSeconds > 0) {
          const elapsed =
            parseInt(timeMatch[1], 10) * 3600 +
            parseInt(timeMatch[2], 10) * 60 +
            parseFloat(timeMatch[3]);
          const pct = Math.min(99, Math.round((elapsed / durationSeconds) * 100));
          parentPort?.postMessage({ type: 'progress', profileName, percent: pct });
        }
      }
    });

    proc.on('error', (err) => {
      reject(new Error(`FFmpeg process error: ${err.message}`));
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        if (isCancelled) {
          reject(new Error('Transcoding was cancelled'));
        } else {
          const lastLines = stderrOutput.split('\n').slice(-20).join('\n');
          reject(new Error(`FFmpeg exited with code ${code}.\n${lastLines}`));
        }
      }
    });
  });
}

async function runWorker(): Promise<void> {
  const { inputPath, outputDir, profile, segmentDuration, ffmpegPath, durationSeconds, audioTracks } = data;

  const playlistPath = path.join(outputDir, 'playlist.m3u8');
  const segmentPattern = path.join(outputDir, 'segment_%03d.ts');

  const scaleFilter =
    `scale=${profile.width}:${profile.height}:` +
    `force_original_aspect_ratio=decrease,` +
    `pad=${profile.width}:${profile.height}:(ow-iw)/2:(oh-ih)/2,` +
    `format=yuv420p`;

  // ── Step 1: Transcode video + default (first) audio track ──────────────────
  const args = [
    '-i', inputPath,
    '-map', '0:v:0',
    '-map', '0:a:0?',
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '23',
    '-maxrate', profile.videoBitrate,
    '-bufsize', `${parseInt(profile.videoBitrate, 10) * 2}k`,
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
    '-progress', 'pipe:2',
    '-nostats',
    playlistPath,
  ];

  await runFfmpeg(args, ffmpegPath, durationSeconds, profile.name);

  // ── Step 2: Extract additional audio tracks as separate HLS audio playlists ─
  const hasMultipleAudio = audioTracks && audioTracks.length > 1;
  if (hasMultipleAudio) {
    for (let i = 1; i < audioTracks.length; i++) {
      if (isCancelled) break;
      const track = audioTracks[i];
      const audioDir = path.join(outputDir, `audio_${i}`);
      await fs.mkdir(audioDir, { recursive: true });

      const audioPlaylistPath = path.join(audioDir, 'playlist.m3u8');
      const audioSegmentPattern = path.join(audioDir, 'segment_%03d.ts');

      const audioArgs = [
        '-i', inputPath,
        '-map', `0:a:${i}`,
        '-vn',
        '-c:a', 'aac',
        '-b:a', profile.audioBitrate,
        '-ac', '2',
        '-f', 'hls',
        '-hls_time', String(segmentDuration),
        '-hls_list_size', '0',
        '-hls_segment_type', 'mpegts',
        '-hls_segment_filename', audioSegmentPattern,
        '-hls_flags', 'independent_segments',
        '-progress', 'pipe:2',
        '-nostats',
        audioPlaylistPath,
      ];

      // Don't report progress for audio-only tracks (it would confuse the main progress)
      await runFfmpeg(audioArgs, ffmpegPath, durationSeconds, profile.name);
    }
  }

  parentPort?.postMessage({ type: 'progress', profileName: profile.name, percent: 100 });
  parentPort?.postMessage({ type: 'complete', profileName: profile.name });
  setTimeout(() => {
    process.exit(0);
  }, 50);
}

runWorker().catch((err: Error) => {
  parentPort?.postMessage({
    type: 'error',
    profileName: data.profile.name,
    error: err.message,
  });
  process.exit(1);
});
