import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { scanDirectory, isSupportedExtension } from '../src/services/movieScanner.js';

describe('isSupportedExtension', () => {
  const supported = ['.mp4', '.mkv', '.mov', '.avi', '.m4v', '.webm'];
  const unsupported = ['.jpg', '.png', '.txt', '.srt', '.nfo', '.exe', '.pdf'];

  supported.forEach((ext) => {
    it(`accepts ${ext}`, () => {
      expect(isSupportedExtension(ext)).toBe(true);
    });

    it(`accepts ${ext.toUpperCase()} (case-insensitive)`, () => {
      expect(isSupportedExtension(ext.toUpperCase())).toBe(true);
    });
  });

  unsupported.forEach((ext) => {
    it(`rejects ${ext}`, () => {
      expect(isSupportedExtension(ext)).toBe(false);
    });
  });
});

describe('scanDirectory', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'movie-scan-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  async function createFile(name: string, content = 'fake'): Promise<void> {
    await fs.writeFile(path.join(tmpDir, name), content);
  }

  it('returns only supported video files', async () => {
    await createFile('Movie (2020).mkv');
    await createFile('Short.mp4');
    await createFile('poster.jpg');
    await createFile('subtitle.srt');
    await createFile('info.nfo');
    await createFile('readme.txt');

    const results = await scanDirectory(tmpDir);
    const names = results.map((r) => r.filename);

    expect(names).toContain('Movie (2020).mkv');
    expect(names).toContain('Short.mp4');
    expect(names).not.toContain('poster.jpg');
    expect(names).not.toContain('subtitle.srt');
    expect(names).not.toContain('info.nfo');
    expect(names).not.toContain('readme.txt');
  });

  it('is case-insensitive for extensions', async () => {
    await createFile('Movie.MKV');
    await createFile('Another.Mp4');
    await createFile('Third.MOV');

    const results = await scanDirectory(tmpDir);
    const names = results.map((r) => r.filename);

    expect(names).toContain('Movie.MKV');
    expect(names).toContain('Another.Mp4');
    expect(names).toContain('Third.MOV');
  });

  it('returns empty array for empty directory', async () => {
    const results = await scanDirectory(tmpDir);
    expect(results).toHaveLength(0);
  });

  it('returns empty array for non-existent directory', async () => {
    const results = await scanDirectory(path.join(tmpDir, 'nonexistent'));
    expect(results).toHaveLength(0);
  });

  it('includes correct metadata in results', async () => {
    await createFile('Test Movie (2024).mp4', 'x'.repeat(1000));

    const results = await scanDirectory(tmpDir);
    expect(results).toHaveLength(1);

    const file = results[0];
    expect(file).toBeDefined();
    expect(file!.filename).toBe('Test Movie (2024).mp4');
    expect(file!.extension).toBe('.mp4');
    expect(file!.sizeBytes).toBeGreaterThan(0);
    expect(file!.modifiedTime).toBeGreaterThan(0);
  });

  it('does not recurse into subdirectories', async () => {
    const subDir = path.join(tmpDir, 'subdir');
    await fs.mkdir(subDir);
    await fs.writeFile(path.join(subDir, 'hidden.mkv'), 'fake');
    await createFile('visible.mkv');

    const results = await scanDirectory(tmpDir);
    const names = results.map((r) => r.filename);

    expect(names).toContain('visible.mkv');
    expect(names).not.toContain('hidden.mkv');
  });

  it('handles all supported extensions', async () => {
    const extensions = ['mp4', 'mkv', 'mov', 'avi', 'm4v', 'webm'];
    for (const ext of extensions) {
      await createFile(`movie.${ext}`);
    }

    const results = await scanDirectory(tmpDir);
    expect(results).toHaveLength(extensions.length);
  });
});
