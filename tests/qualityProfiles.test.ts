import { describe, it, expect } from 'vitest';
import { selectQualityProfiles } from '../src/services/ffmpegService.js';
import { QUALITY_PROFILES } from '../src/types/movie.js';

const ALL_ENABLED = {
  transcode480p: true,
  transcode720p: true,
  transcode1080p: true,
  transcode2160p: true,
};

describe('selectQualityProfiles — no upscaling', () => {
  it('selects every profile for a 4K (2160p) source', () => {
    const names = selectQualityProfiles(2160, ALL_ENABLED).map((p) => p.name);
    expect(names).toEqual(['480p', '720p', '1080p', '2160p']);
  });

  it('never selects 2160p for a 1080p source', () => {
    const names = selectQualityProfiles(1080, ALL_ENABLED).map((p) => p.name);
    expect(names).not.toContain('2160p');
    expect(names).toEqual(['480p', '720p', '1080p']);
  });

  it('never selects a profile taller than the source', () => {
    for (const sourceHeight of [480, 720, 1080, 2160]) {
      for (const profile of selectQualityProfiles(sourceHeight, ALL_ENABLED)) {
        expect(profile.height).toBeLessThanOrEqual(sourceHeight);
      }
    }
  });

  it('returns no profiles for an unknown/zero source height', () => {
    expect(selectQualityProfiles(0, ALL_ENABLED)).toEqual([]);
  });

  it('honours disabled profile flags', () => {
    const names = selectQualityProfiles(2160, {
      ...ALL_ENABLED,
      transcode2160p: false,
      transcode480p: false,
    }).map((p) => p.name);
    expect(names).toEqual(['720p', '1080p']);
  });

  it('exposes 4K as the 3840x2160 profile in QUALITY_PROFILES', () => {
    const fourK = QUALITY_PROFILES.find((p) => p.name === '2160p');
    expect(fourK).toMatchObject({ width: 3840, height: 2160 });
  });
});
