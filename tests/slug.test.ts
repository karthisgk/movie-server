import { describe, it, expect } from 'vitest';
import { generateMovieId, generateMovieTitle, isValidMovieId } from '../src/utils/slug.js';

describe('generateMovieId', () => {
  it('converts "Interstellar (2014).mkv" → "interstellar-2014"', () => {
    expect(generateMovieId('Interstellar (2014).mkv')).toBe('interstellar-2014');
  });

  it('converts "The Dark Knight (2008).mp4" → "the-dark-knight-2008"', () => {
    expect(generateMovieId('The Dark Knight (2008).mp4')).toBe('the-dark-knight-2008');
  });

  it('converts "Inception (2010).mp4" → "inception-2010"', () => {
    expect(generateMovieId('Inception (2010).mp4')).toBe('inception-2010');
  });

  it('converts "Avatar (2009).mkv" → "avatar-2009"', () => {
    expect(generateMovieId('Avatar (2009).mkv')).toBe('avatar-2009');
  });

  it('handles multiple spaces', () => {
    expect(generateMovieId('The  Movie  (2020).mkv')).toBe('the-movie-2020');
  });

  it('handles uppercase extensions', () => {
    expect(generateMovieId('Movie.MKV')).toBe('movie');
  });

  it('handles apostrophes', () => {
    const id = generateMovieId("It's a Wonderful Life (1946).mp4");
    expect(id).toBe('its-a-wonderful-life-1946');
  });

  it('handles hyphens in the title', () => {
    const id = generateMovieId('Spider-Man No Way Home (2021).mkv');
    expect(id).toBe('spider-man-no-way-home-2021');
  });

  it('removes leading and trailing hyphens', () => {
    const id = generateMovieId('(Test Movie) [2022].mp4');
    expect(id).not.toMatch(/^-|-$/);
  });

  it('produces the same ID for the same filename (deterministic)', () => {
    const name = 'Interstellar (2014).mkv';
    expect(generateMovieId(name)).toBe(generateMovieId(name));
  });

  it('handles The Lord of the Rings with punctuation', () => {
    const id = generateMovieId('The Lord of the Rings - The Return of the King (2003).mkv');
    expect(id).toBe('the-lord-of-the-rings-the-return-of-the-king-2003');
  });
});

describe('generateMovieTitle', () => {
  it('strips extension from filename', () => {
    expect(generateMovieTitle('Interstellar (2014).mkv')).toBe('Interstellar (2014)');
  });

  it('handles .mp4', () => {
    expect(generateMovieTitle('The Dark Knight (2008).mp4')).toBe('The Dark Knight (2008)');
  });
});

describe('isValidMovieId', () => {
  it('accepts valid IDs', () => {
    expect(isValidMovieId('interstellar-2014')).toBe(true);
    expect(isValidMovieId('the-dark-knight-2008')).toBe(true);
    expect(isValidMovieId('a')).toBe(true);
    expect(isValidMovieId('abc123')).toBe(true);
  });

  it('rejects IDs with path traversal sequences', () => {
    expect(isValidMovieId('../etc/passwd')).toBe(false);
    expect(isValidMovieId('..')).toBe(false);
  });

  it('rejects IDs with forward slashes', () => {
    expect(isValidMovieId('some/path')).toBe(false);
  });

  it('rejects IDs with backslashes', () => {
    expect(isValidMovieId('some\\path')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isValidMovieId('')).toBe(false);
  });

  it('rejects null-like values', () => {
    expect(isValidMovieId(null as unknown as string)).toBe(false);
    expect(isValidMovieId(undefined as unknown as string)).toBe(false);
  });

  it('rejects IDs with uppercase letters', () => {
    // IDs are always lowercase slugs
    expect(isValidMovieId('Interstellar-2014')).toBe(false);
  });
});
