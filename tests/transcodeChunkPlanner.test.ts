import { describe, it, expect } from 'vitest';
import {
  planTranscodeChunks,
  normalizeChunkDuration,
  totalPlannedDuration,
  aggregateChunkProgress,
} from '../src/services/transcodeChunkPlanner.js';

describe('normalizeChunkDuration', () => {
  it('keeps a chunk duration that is already a whole number of segments', () => {
    expect(normalizeChunkDuration(120, 6)).toBe(120);
    expect(normalizeChunkDuration(12, 6)).toBe(12);
  });

  it('rounds to the nearest whole number of segments', () => {
    expect(normalizeChunkDuration(125, 6)).toBe(126); // 21 segments
    expect(normalizeChunkDuration(10, 6)).toBe(12); // 2 segments
  });

  it('never returns less than one segment', () => {
    expect(normalizeChunkDuration(1, 6)).toBe(6);
    // A non-positive request falls back to the 120s default (20 segments).
    expect(normalizeChunkDuration(0, 6)).toBe(120);
  });
});

describe('planTranscodeChunks', () => {
  it('splits a 1-hour movie into exact 120s chunks (segment-aligned)', () => {
    const chunks = planTranscodeChunks({
      durationSeconds: 3600,
      chunkDurationSeconds: 120,
      segmentDurationSeconds: 6,
    });

    expect(chunks).toHaveLength(30);
    expect(chunks[0]).toMatchObject({ index: 0, startSec: 0, durationSec: 120, startSegmentNumber: 0 });
    expect(chunks[1]).toMatchObject({ index: 1, startSec: 120, durationSec: 120, startSegmentNumber: 20 });
    expect(chunks[29]).toMatchObject({ index: 29, startSec: 3480, durationSec: 120, startSegmentNumber: 580 });
    expect(totalPlannedDuration(chunks)).toBe(3600);
  });

  it('makes the final chunk shorter when the duration is not an exact multiple', () => {
    const chunks = planTranscodeChunks({
      durationSeconds: 3650,
      chunkDurationSeconds: 120,
      segmentDurationSeconds: 6,
    });

    expect(chunks).toHaveLength(31);
    expect(chunks[30].startSec).toBe(3600);
    expect(chunks[30].durationSec).toBe(50);
    expect(totalPlannedDuration(chunks)).toBe(3650);
  });

  it('starts every chunk on a segment boundary', () => {
    const chunks = planTranscodeChunks({
      durationSeconds: 1000,
      chunkDurationSeconds: 100, // rounded to 102s (17 segments)
      segmentDurationSeconds: 6,
    });

    for (const chunk of chunks) {
      expect(chunk.startSec % 6).toBe(0);
      expect(chunk.startSegmentNumber).toBe(chunk.startSec / 6);
    }
  });

  it('returns an empty plan for an unknown or non-positive duration', () => {
    expect(planTranscodeChunks({ durationSeconds: 0, chunkDurationSeconds: 120, segmentDurationSeconds: 6 })).toEqual([]);
    expect(planTranscodeChunks({ durationSeconds: -10, chunkDurationSeconds: 120, segmentDurationSeconds: 6 })).toEqual([]);
    expect(planTranscodeChunks({ durationSeconds: NaN, chunkDurationSeconds: 120, segmentDurationSeconds: 6 })).toEqual([]);
  });

  it('produces a single chunk when the movie is shorter than one chunk', () => {
    const chunks = planTranscodeChunks({
      durationSeconds: 45,
      chunkDurationSeconds: 120,
      segmentDurationSeconds: 6,
    });
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({ index: 0, startSec: 0, durationSec: 45, startSegmentNumber: 0 });
  });
});

describe('aggregateChunkProgress', () => {
  it('weights progress by chunk duration', () => {
    const chunks = planTranscodeChunks({
      durationSeconds: 30,
      chunkDurationSeconds: 12,
      segmentDurationSeconds: 6,
    });
    // chunks: 12s, 12s, 6s

    expect(aggregateChunkProgress(chunks, new Map())).toBe(0);
    expect(aggregateChunkProgress(chunks, new Map([[0, 100]]))).toBe(40); // 12/30
    expect(
      aggregateChunkProgress(
        chunks,
        new Map([
          [0, 100],
          [1, 100],
          [2, 100],
        ]),
      ),
    ).toBe(100);
  });

  it('captures partial progress of the in-flight chunk', () => {
    const chunks = planTranscodeChunks({
      durationSeconds: 24,
      chunkDurationSeconds: 12,
      segmentDurationSeconds: 6,
    });
    // chunks: 12s, 12s
    expect(aggregateChunkProgress(chunks, new Map([[0, 100], [1, 50]]))).toBe(75);
  });
});
