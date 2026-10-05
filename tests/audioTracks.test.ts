import { describe, it, expect } from 'vitest';
import { AudioTrackInfo } from '../src/types/movie.js';
import {
  isTamilTrack,
  prioritizeAudioTracks,
  resolveSourceAudioIndex,
} from '../src/services/audioTrackPrioritizer.js';

function track(overrides: Partial<AudioTrackInfo> & { sourceAudioIndex: number }): AudioTrackInfo {
  return {
    streamIndex: overrides.sourceAudioIndex + 1,
    language: 'eng',
    label: 'English (Stereo)',
    codec: 'aac',
    channels: 2,
    ...overrides,
  };
}

describe('isTamilTrack', () => {
  it('matches Tamil language codes', () => {
    expect(isTamilTrack(track({ sourceAudioIndex: 0, language: 'tam' }))).toBe(true);
    expect(isTamilTrack(track({ sourceAudioIndex: 0, language: 'ta' }))).toBe(true);
    expect(isTamilTrack(track({ sourceAudioIndex: 0, language: 'TAM' }))).toBe(true);
    expect(isTamilTrack(track({ sourceAudioIndex: 0, language: 'tamil' }))).toBe(true);
  });

  it('matches Tamil by label when the language tag is missing/mislabelled', () => {
    expect(isTamilTrack(track({ sourceAudioIndex: 0, language: 'und', label: 'Tamil 5.1' }))).toBe(true);
    expect(isTamilTrack(track({ sourceAudioIndex: 0, language: 'eng', label: 'Tamil [Original]' }))).toBe(true);
  });

  it('does not match other languages', () => {
    expect(isTamilTrack(track({ sourceAudioIndex: 0, language: 'eng', label: 'English' }))).toBe(false);
    expect(isTamilTrack(track({ sourceAudioIndex: 0, language: 'hin', label: 'Hindi 5.1' }))).toBe(false);
    expect(isTamilTrack(track({ sourceAudioIndex: 0, language: 'tel', label: 'Telugu' }))).toBe(false);
  });
});

describe('prioritizeAudioTracks', () => {
  it('moves the Tamil track to index 0 while preserving source mapping', () => {
    const tracks = [
      track({ sourceAudioIndex: 0, language: 'eng', label: 'English (Stereo)' }),
      track({ sourceAudioIndex: 1, language: 'tam', label: 'Tamil (Stereo)' }),
      track({ sourceAudioIndex: 2, language: 'hin', label: 'Hindi (Stereo)' }),
    ];

    const ordered = prioritizeAudioTracks(tracks);

    expect(ordered.map((t) => t.label)).toEqual([
      'Tamil (Stereo)',
      'English (Stereo)',
      'Hindi (Stereo)',
    ]);
    // The Tamil track still points at source stream 0:a:1.
    expect(ordered[0].sourceAudioIndex).toBe(1);
    expect(ordered[1].sourceAudioIndex).toBe(0);
    expect(ordered[2].sourceAudioIndex).toBe(2);
  });

  it('orders multiple Tamil tracks by channel count (5.1 before stereo)', () => {
    const tracks = [
      track({ sourceAudioIndex: 0, language: 'eng', label: 'English' }),
      track({ sourceAudioIndex: 1, language: 'tam', label: 'Tamil (Stereo)', channels: 2 }),
      track({ sourceAudioIndex: 2, language: 'tam', label: 'Tamil (5.1)', channels: 6 }),
    ];

    const ordered = prioritizeAudioTracks(tracks);

    expect(ordered.map((t) => t.label)).toEqual(['Tamil (5.1)', 'Tamil (Stereo)', 'English']);
    expect(ordered.map((t) => t.sourceAudioIndex)).toEqual([2, 1, 0]);
  });

  it('keeps original order when no Tamil track exists', () => {
    const tracks = [
      track({ sourceAudioIndex: 0, language: 'hin', label: 'Hindi' }),
      track({ sourceAudioIndex: 1, language: 'eng', label: 'English' }),
      track({ sourceAudioIndex: 2, language: 'tel', label: 'Telugu' }),
    ];

    const ordered = prioritizeAudioTracks(tracks);

    expect(ordered.map((t) => t.sourceAudioIndex)).toEqual([0, 1, 2]);
    expect(ordered).not.toBe(tracks); // returns a copy
  });

  it('preserves the relative order of non-Tamil tracks', () => {
    const tracks = [
      track({ sourceAudioIndex: 0, language: 'hin', label: 'Hindi' }),
      track({ sourceAudioIndex: 1, language: 'tam', label: 'Tamil' }),
      track({ sourceAudioIndex: 2, language: 'tel', label: 'Telugu' }),
      track({ sourceAudioIndex: 3, language: 'eng', label: 'English' }),
    ];

    const ordered = prioritizeAudioTracks(tracks);

    expect(ordered.map((t) => t.language)).toEqual(['tam', 'hin', 'tel', 'eng']);
  });
});

describe('resolveSourceAudioIndex', () => {
  it('uses the recorded source index when present', () => {
    expect(resolveSourceAudioIndex(track({ sourceAudioIndex: 3 }), 0)).toBe(3);
  });

  it('falls back to the presentation index for legacy/absent data', () => {
    const legacy = { streamIndex: 1, language: 'und', label: 'x', codec: 'aac', channels: 2 } as AudioTrackInfo;
    expect(resolveSourceAudioIndex(legacy, 2)).toBe(2);
    expect(resolveSourceAudioIndex(undefined, 1)).toBe(1);
  });
});