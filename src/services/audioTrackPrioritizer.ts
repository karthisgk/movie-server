import { AudioTrackInfo } from '../types/movie.js';

/** Language tags/aliases that identify a Tamil audio stream. */
const TAMIL_CODES = new Set(['tam', 'ta', 'tamil']);

/**
 * Returns true when a track is Tamil, matched by ISO language code or by the
 * human-readable label (covers badly-tagged releases like "Tamil 5.1").
 */
export function isTamilTrack(track: AudioTrackInfo): boolean {
  const language = (track.language ?? '').trim().toLowerCase();
  const label = (track.label ?? '').trim().toLowerCase();
  if (TAMIL_CODES.has(language)) return true;
  return label.includes('tamil');
}

/**
 * Reorders audio tracks so Tamil renditions come first (highest channel count
 * first), with every other track keeping its original relative order. When no
 * Tamil track exists the input order is returned unchanged.
 *
 * Ordering is presentation-only: each track keeps its `sourceAudioIndex` so
 * extraction always maps back to the correct source stream (`-map 0:a:<n>`).
 */
export function prioritizeAudioTracks(tracks: AudioTrackInfo[]): AudioTrackInfo[] {
  const tamil = tracks.filter(isTamilTrack);
  if (tamil.length === 0) {
    return [...tracks];
  }

  const tamilSorted = [...tamil].sort((a, b) => (b.channels ?? 0) - (a.channels ?? 0));
  const others = tracks.filter((track) => !isTamilTrack(track));
  return [...tamilSorted, ...others];
}

/**
 * Resolves the FFmpeg source audio index for a track, falling back to its
 * presentation index when the field is absent (metadata written by older builds).
 */
export function resolveSourceAudioIndex(track: AudioTrackInfo | undefined, presentationIndex: number): number {
  const value = track?.sourceAudioIndex;
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : presentationIndex;
}