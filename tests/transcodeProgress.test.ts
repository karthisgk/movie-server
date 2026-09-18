import { describe, it, expect } from 'vitest';

describe('Multi-threaded resolution progress calculation', () => {
  it('calculates equal share overall percentage across 2 resolution profiles (720p, 1080p)', () => {
    const profiles = ['1080p', '720p'];
    const totalCount = profiles.length;
    const progressMap: Record<string, number> = {
      '1080p': 0,
      '720p': 0,
    };

    const calcOverall = () => {
      const sum = profiles.reduce((acc, p) => acc + (progressMap[p] ?? 0), 0);
      return Math.min(100, Math.round(sum / totalCount));
    };

    expect(calcOverall()).toBe(0);

    // 720p worker advances to 50%, 1080p at 30%
    progressMap['720p'] = 50;
    progressMap['1080p'] = 30;
    expect(calcOverall()).toBe(40); // (50 + 30) / 2 = 40

    // 720p finishes (100%), 1080p at 50%
    progressMap['720p'] = 100;
    progressMap['1080p'] = 50;
    expect(calcOverall()).toBe(75); // (100 + 50) / 2 = 75

    // Both finish (100%)
    progressMap['1080p'] = 100;
    expect(calcOverall()).toBe(100);
  });

  it('calculates equal share overall percentage across 3 resolution profiles (480p, 720p, 1080p)', () => {
    const profiles = ['1080p', '720p', '480p'];
    const totalCount = profiles.length;
    const progressMap: Record<string, number> = {
      '1080p': 0,
      '720p': 0,
      '480p': 0,
    };

    const calcOverall = () => {
      const sum = profiles.reduce((acc, p) => acc + (progressMap[p] ?? 0), 0);
      return Math.min(100, Math.round(sum / totalCount));
    };

    expect(calcOverall()).toBe(0);

    progressMap['480p'] = 60;
    progressMap['720p'] = 30;
    progressMap['1080p'] = 0;
    expect(calcOverall()).toBe(30); // (60 + 30 + 0) / 3 = 30

    progressMap['480p'] = 100;
    progressMap['720p'] = 100;
    progressMap['1080p'] = 100;
    expect(calcOverall()).toBe(100);
  });

  it('handles crash-recovery with pre-completed profiles', () => {
    const profiles = ['1080p', '720p'];
    const alreadyCompleted = ['720p'];
    const totalCount = profiles.length;

    const progressMap: Record<string, number> = {
      '1080p': 0,
      '720p': 100, // pre-completed profile counts as 100%
    };

    const calcOverall = () => {
      const sum = profiles.reduce((acc, p) => acc + (progressMap[p] ?? 0), 0);
      return Math.min(100, Math.round(sum / totalCount));
    };

    expect(calcOverall()).toBe(50); // (0 + 100) / 2 = 50%

    progressMap['1080p'] = 50;
    expect(calcOverall()).toBe(75); // (50 + 100) / 2 = 75%
  });
});
