# CLAUDE.md — Developer Reference

## Architecture

```
src/
├── config/env.ts          — Environment variable loader & validator
├── types/movie.ts          — Movie interface, status types, quality profiles
├── utils/
│   ├── logger.ts           — [INFO]/[WARN]/[ERROR] timestamped logger
│   ├── slug.ts             — Deterministic movie ID generation
│   └── filesystem.ts       — ensureDir, fileExists, moveDir, path traversal protection
├── services/
│   ├── movieScanner.ts     — Flat directory scan for video files
│   ├── movieRegistry.ts    — In-memory Map<id, Movie> registry
│   ├── ffmpegService.ts    — ffprobe metadata + FFmpeg HLS transcoding (spawn, no shell strings)
│   ├── transcodingQueue.ts — Concurrency-limited job queue
│   ├── hlsService.ts       — HLS stale detection, validation, cleanup
│   └── movieWatcher.ts     — Chokidar file watcher → full pipeline orchestrator
├── routes/
│   ├── healthRoutes.ts     — GET /health
│   └── videoRoutes.ts      — GET /videos, /videos/:id, /videos/:id/play, /hls/:id/*
├── middleware/
│   └── errorHandler.ts     — Centralized error handler (no stack traces to client)
└── server.ts               — Bootstrap: validate → scan → watch → Express
```

## Development Commands

```bash
npm run dev       # tsx watch — hot-reload development
npm run build     # tsc — compile to dist/
npm start         # node dist/server.js — production
npm test          # vitest run
```

## Key Design Decisions

- **No database** — filesystem is source of truth, in-memory registry rebuilt on restart
- **spawn() not exec()** — all FFmpeg/ffprobe calls use spawn with arg arrays to safely handle filenames with spaces, parentheses, Unicode
- **Atomic HLS output** — FFmpeg writes to `.tmp-<id>/`, renamed to `<id>/` only on success
- **Stale detection** — `metadata.json` stores source size + mtime; checked on every restart
- **No upscaling** — quality profiles filtered against source height
- **Path traversal protection** — all HLS paths verified to stay within hlsDirectory root

## Movie ID Generation

`slug.ts::generateMovieId(filename)`:
1. Strip extension
2. Lowercase
3. Replace non-alphanumeric chars with `-`
4. Collapse consecutive `-`
5. Trim leading/trailing `-`

## FFmpeg Arguments

FFmpeg is called with an argument array (never a shell string). Key flags:
- `-map 0:v:0` — first video stream
- `-map 0:a:0?` — first audio stream (optional, so silent files don't fail)
- `-c:v libx264 -preset veryfast -crf 23` — CPU encoding
- `-vf scale=W:H:force_original_aspect_ratio=decrease,pad,...` — aspect-ratio-safe scaling
- `-hls_segment_type mpegts` — MPEG-TS for VLC compatibility
- `-hls_list_size 0` — include all segments in playlist

## Adding Hardware Encoding (Future)

Replace `-c:v libx264` with `-c:v h264_nvenc` (NVIDIA) or `-c:v h264_qsv` (Intel).
The argument construction in `ffmpegService.ts::transcodeProfile()` is designed for this.

## Test Isolation

Tests never touch `MOVIE_DIRECTORY` or `HLS_DIRECTORY`.
`movieScanner.test.ts` uses `os.tmpdir()` for temp directories.
`videoRoutes.test.ts` uses an in-memory registry with no filesystem access.
