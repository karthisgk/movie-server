/**
 * Chunk planning for the waterfall transcoding pipeline.
 *
 * A movie timeline is sliced into fixed-duration chunks that are whole multiples
 * of the HLS segment duration. Aligning chunk boundaries to segment boundaries
 * guarantees that every chunk starts on a forced keyframe, so the stitched output
 * can be segmented cleanly without re-encoding.
 *
 * See CHUNK_TRANSCODING_PLAN.md (Phase 2 — Chunk Partitioning & Keyframe Alignment).
 */

export interface TranscodeChunk {
  /** Zero-based chunk index. */
  index: number;
  /** Start of the chunk, in seconds, from the beginning of the movie. */
  startSec: number;
  /** Duration of the chunk in seconds (the last chunk may be shorter). */
  durationSec: number;
  /** Global HLS segment number this chunk starts at (startSec / segmentDuration). */
  startSegmentNumber: number;
}

export interface ChunkPlanOptions {
  /** Total source duration in seconds. */
  durationSeconds: number;
  /** Requested chunk length in seconds (rounded to a whole number of segments). */
  chunkDurationSeconds: number;
  /** HLS segment duration in seconds. */
  segmentDurationSeconds: number;
}

/**
 * Rounds the requested chunk duration to the nearest whole number of segments,
 * never below one segment. e.g. chunk=120s, segment=6s → 120s (20 segments).
 */
export function normalizeChunkDuration(
  chunkDurationSeconds: number,
  segmentDurationSeconds: number,
): number {
  const segment = segmentDurationSeconds > 0 ? Math.floor(segmentDurationSeconds) : 6;
  const requested = chunkDurationSeconds > 0 ? Math.floor(chunkDurationSeconds) : 120;
  const segmentsPerChunk = Math.max(1, Math.round(requested / segment));
  return segmentsPerChunk * segment;
}

/**
 * Splits a movie into segment-aligned chunks.
 *
 * Chunk k covers [k * C, min((k + 1) * C, T)) where C is the normalised chunk
 * duration and T is the total duration. A non-positive/unknown duration yields
 * an empty plan — callers must fall back to whole-file transcoding in that case.
 */
export function planTranscodeChunks(options: ChunkPlanOptions): TranscodeChunk[] {
  const { durationSeconds } = options;
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return [];
  }

  const segmentDuration =
    options.segmentDurationSeconds > 0 ? Math.floor(options.segmentDurationSeconds) : 6;
  const chunkDuration = normalizeChunkDuration(
    options.chunkDurationSeconds,
    options.segmentDurationSeconds,
  );

  const chunkCount = Math.max(1, Math.ceil(durationSeconds / chunkDuration));
  const chunks: TranscodeChunk[] = [];

  for (let index = 0; index < chunkCount; index++) {
    const startSec = index * chunkDuration;
    const durationSec = Math.min(chunkDuration, durationSeconds - startSec);
    if (durationSec <= 0) break;

    chunks.push({
      index,
      startSec,
      durationSec,
      startSegmentNumber: Math.round(startSec / segmentDuration),
    });
  }

  return chunks;
}

/** Sum of all chunk durations — useful for progress weighting and validation. */
export function totalPlannedDuration(chunks: TranscodeChunk[]): number {
  return chunks.reduce((sum, chunk) => sum + chunk.durationSec, 0);
}

/**
 * Computes overall progress (0–100) for a profile given how far each chunk has
 * progressed. Progress is weighted by chunk duration so the final short chunk
 * does not overstate completion.
 */
export function aggregateChunkProgress(
  chunks: TranscodeChunk[],
  progressByIndex: Map<number, number>,
): number {
  const total = totalPlannedDuration(chunks);
  if (total <= 0) return 0;

  let done = 0;
  for (const chunk of chunks) {
    const percent = Math.max(0, Math.min(100, progressByIndex.get(chunk.index) ?? 0));
    done += (percent / 100) * chunk.durationSec;
  }

  return Math.min(100, Math.round((done / total) * 100));
}
