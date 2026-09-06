# Home LAN Movie Streaming Server
## Complete Antigravity Implementation Specification

You are Antigravity working inside a local development environment.

Build a **fully working home-network movie streaming server for Windows** using:

- Node.js
- TypeScript
- Express
- FFmpeg
- HLS
- Chokidar
- VLC-compatible playback
- Local filesystem storage

The application is **NOT a Netflix clone**.

It is a personal/home-network media server where movies are manually placed into:

```text
D:\Movies
```

The server automatically discovers those movie files, generates HLS versions using FFmpeg when necessary, and exposes playback URLs that can be opened from VLC on:

- Android phones
- Android tablets
- Android TV
- Windows VLC
- Other HLS-compatible clients

The entire application should run locally on a Windows PC.

---

# 1. Primary Goal

Build this complete flow:

```text
D:\Movies
    │
    │ Movie files manually copied here
    ▼
Movie File Watcher
    │
    ▼
Movie Scanner
    │
    ▼
Movie Metadata / File Validation
    │
    ▼
FFmpeg Transcoding Manager
    │
    ▼
HLS Output
    │
    ├── master.m3u8
    ├── 480p
    ├── 720p
    └── 1080p
    │
    ▼
Node.js / Express HTTP Server
    │
    ▼
Home LAN
    │
    ├── VLC Mobile
    ├── VLC Android TV
    └── VLC Desktop
```

The main playback endpoint must be:

```http
GET /videos/:id/play
```

Example:

```text
http://192.168.1.100:5000/videos/interstellar-2014/play
```

This endpoint should redirect to the appropriate HLS master playlist.

---

# 2. Important Scope Restrictions

Do NOT build the following unless explicitly requested later:

- User registration
- Login system
- Cloud storage
- AWS
- Azure
- Google Cloud
- MongoDB
- PostgreSQL
- Redis
- CDN
- Payment system
- Subscription system
- Admin upload dashboard
- Movie upload API
- Social features
- Recommendations
- Public internet deployment
- DRM
- Netflix UI clone

The filesystem is the source of truth.

Movies are manually placed into:

```text
D:\Movies
```

The application should automatically detect them.

---

# 3. Target Environment

Primary target:

```text
Windows 10 / Windows 11
```

Runtime:

```text
Node.js 20+
```

Use modern TypeScript.

Use ESM-compatible TypeScript configuration.

The application must work correctly with Windows paths such as:

```text
D:\Movies
D:\MovieStream\hls
```

Do NOT hard-code Windows paths inside TypeScript source code.

Use environment variables.

---

# 4. Project Structure

Create this structure:

```text
movie-stream-server/
│
├── src/
│   ├── config/
│   │   └── env.ts
│   │
│   ├── types/
│   │   └── movie.ts
│   │
│   ├── services/
│   │   ├── movieScanner.ts
│   │   ├── movieRegistry.ts
│   │   ├── ffmpegService.ts
│   │   ├── transcodingQueue.ts
│   │   ├── hlsService.ts
│   │   └── movieWatcher.ts
│   │
│   ├── routes/
│   │   ├── healthRoutes.ts
│   │   └── videoRoutes.ts
│   │
│   ├── middleware/
│   │   └── errorHandler.ts
│   │
│   ├── utils/
│   │   ├── slug.ts
│   │   ├── filesystem.ts
│   │   └── logger.ts
│   │
│   └── server.ts
│
├── tests/
│   ├── slug.test.ts
│   ├── movieScanner.test.ts
│   └── videoRoutes.test.ts
│
├── hls/
│
├── .env.example
├── .gitignore
├── package.json
├── tsconfig.json
├── README.md
└── CLAUDE.md
```

Keep the architecture modular.

Do not put the entire application inside `server.ts`.

---

# 5. Environment Variables

Create:

```text
.env.example
```

with:

```env
MOVIE_DIRECTORY=D:\Movies
HLS_DIRECTORY=D:\MovieStream\hls

HOST=0.0.0.0
PORT=5000

FFMPEG_PATH=ffmpeg
FFPROBE_PATH=ffprobe

TRANSCODE_480P=true
TRANSCODE_720P=true
TRANSCODE_1080P=true

HLS_SEGMENT_DURATION=6

MAX_CONCURRENT_TRANSCODES=1

AUTO_TRANSCODE=true
```

Create `.env` locally if needed.

Never commit `.env`.

---

# 6. Configuration Requirements

Validate environment variables at startup.

If:

```text
MOVIE_DIRECTORY
```

does not exist:

- create it automatically if possible
- otherwise provide a clear error

If:

```text
HLS_DIRECTORY
```

does not exist:

- create it automatically

If FFmpeg cannot be executed:

```text
ffmpeg -version
```

the application must fail with a clear message explaining that FFmpeg must be installed and added to PATH, or `FFMPEG_PATH` must point to the executable.

Do the same for:

```text
ffprobe
```

---

# 7. Supported Movie Formats

Initially support:

```text
.mp4
.mkv
.mov
.avi
.m4v
.webm
```

The extension check must be case-insensitive.

Therefore:

```text
Movie.MKV
Movie.mkv
Movie.Mkv
```

must all work.

Ignore unsupported files.

Examples:

```text
.jpg
.png
.srt
.nfo
.txt
.exe
```

must not be treated as movies.

---

# 8. Movie Directory

Default:

```text
D:\Movies
```

Example:

```text
D:\Movies\
│
├── Interstellar (2014).mkv
├── Inception (2010).mp4
├── Avatar (2009).mkv
└── The Dark Knight (2008).mp4
```

Do not require a database.

The filesystem is the source of truth.

---

# 9. Automatic Movie Discovery

Use:

```text
chokidar
```

to watch the movie directory.

The application must detect:

### Existing files

When the server starts:

```text
scan D:\Movies
```

### New movie

When:

```text
D:\Movies\New Movie (2025).mkv
```

is added:

```text
watcher
   ↓
detect file
   ↓
wait until file is stable
   ↓
scan/validate
   ↓
register movie
   ↓
queue transcoding
```

### Deleted movie

When a movie is deleted:

```text
D:\Movies\Movie.mkv
```

the registry must remove it.

The generated HLS directory should also be removed or marked stale according to the chosen implementation.

Prefer deleting generated HLS for a movie that no longer exists.

### Renamed movie

Handle rename events safely.

Avoid creating duplicate movie records.

---

# 10. File Stability

IMPORTANT:

When a large movie is being copied into:

```text
D:\Movies
```

the watcher may detect the file before copying is complete.

Do NOT immediately start FFmpeg.

Implement a file stability check.

Example approach:

```text
detect new file
    ↓
wait 5 seconds
    ↓
check file size
    ↓
wait 5 seconds
    ↓
check file size again
    ↓
if unchanged
    ↓
file is considered stable
```

If the file is still changing, continue waiting.

Make this configurable.

Do not process incomplete movie files.

---

# 11. Movie ID Generation

Generate a deterministic ID from the filename.

Example:

```text
Interstellar (2014).mkv
```

should become:

```text
interstellar-2014
```

Example:

```text
The Dark Knight (2008).mp4
```

should become:

```text
the-dark-knight-2008
```

Rules:

- lowercase
- remove extension
- normalize spaces
- convert punctuation to `-`
- remove duplicate hyphens
- trim leading/trailing hyphens

Do NOT use random IDs.

The same filename must always generate the same ID.

IMPORTANT:

The ID must be filesystem-safe.

Never allow:

```text
..
```

or:

```text
/
```

or:

```text
\
```

inside an ID.

---

# 12. Movie Type

Create:

```typescript
interface Movie {
  id: string;
  title: string;
  filename: string;
  sourcePath: string;

  extension: string;
  sizeBytes: number;

  status:
    | "discovered"
    | "queued"
    | "processing"
    | "ready"
    | "failed";

  durationSeconds?: number;

  width?: number;
  height?: number;

  videoCodec?: string;
  audioCodec?: string;

  createdAt: string;
  updatedAt: string;

  error?: string;
}
```

Do not persist this in MongoDB.

For this first version, an in-memory registry is sufficient.

On restart, rescan the filesystem.

---

# 13. Movie Metadata

Use:

```text
ffprobe
```

to retrieve media information.

Collect at least:

```text
duration
width
height
video codec
audio codec
```

Use JSON output from ffprobe.

Do not parse human-readable FFmpeg output when machine-readable JSON is available.

Example command:

```text
ffprobe
-v quiet
-print_format json
-show_format
-show_streams
input.mkv
```

Handle files that have:

- no audio
- multiple audio streams
- no video
- corrupt media

A file without a valid video stream should be marked as failed/invalid.

---

# 14. FFmpeg Architecture

Create a dedicated:

```text
FFmpegService
```

Do not execute shell strings using:

```text
exec("ffmpeg ...")
```

Prefer:

```text
child_process.spawn()
```

with argument arrays.

This avoids quoting and shell escaping problems with Windows filenames.

For example:

```typescript
spawn(ffmpegPath, args)
```

This is especially important for filenames like:

```text
The Lord of the Rings - The Return of the King (2003).mkv
```

---

# 15. HLS Output

For each movie:

```text
D:\MovieStream\hls\<movie-id>\
```

Example:

```text
D:\MovieStream\hls\interstellar-2014\
```

Output:

```text
interstellar-2014/
│
├── master.m3u8
│
├── 480p/
│   ├── playlist.m3u8
│   ├── segment_000.ts
│   ├── segment_001.ts
│   └── ...
│
├── 720p/
│   ├── playlist.m3u8
│   ├── segment_000.ts
│   └── ...
│
└── 1080p/
    ├── playlist.m3u8
    ├── segment_000.ts
    └── ...
```

Do not put HLS files inside:

```text
D:\Movies
```

Keep generated files separate.

---

# 16. HLS Quality Profiles

Implement:

## 480p

Target:

```text
854x480
```

Video:

```text
H.264
```

Audio:

```text
AAC
128 kbps
```

## 720p

Target:

```text
1280x720
```

Video:

```text
H.264
```

Audio:

```text
AAC
128 kbps
```

## 1080p

Target:

```text
1920x1080
```

Video:

```text
H.264
```

Audio:

```text
AAC
128 kbps
```

Use:

```text
libx264
```

initially for compatibility.

Use a reasonable preset such as:

```text
veryfast
```

and an appropriate CRF.

Do not prioritize maximum compression.

The goal is:

```text
reasonable quality
+
reasonable transcoding time
+
VLC compatibility
```

---

# 17. Preserve Aspect Ratio

IMPORTANT.

Do NOT force every video into exactly:

```text
854x480
1280x720
1920x1080
```

because that can distort movies.

Use:

```text
force_original_aspect_ratio=decrease
```

and ensure dimensions are compatible with H.264 requirements.

For example:

```text
21:9 movie
```

should remain widescreen rather than being stretched.

---

# 18. Do Not Upscale Unnecessarily

If the source is only:

```text
640x360
```

do not create:

```text
1080p
```

because that does not create real detail.

Determine which renditions are appropriate based on source resolution.

Example:

```text
Source 720p
    ↓
480p
720p

No 1080p
```

Example:

```text
Source 1080p
    ↓
480p
720p
1080p
```

Example:

```text
Source 4K
    ↓
480p
720p
1080p
```

For this initial implementation, 4K output is NOT required.

---

# 19. Transcoding Queue

Do not start unlimited FFmpeg processes.

Implement:

```text
MAX_CONCURRENT_TRANSCODES=1
```

by default.

Example:

```text
Movie A
Movie B
Movie C
Movie D
```

should become:

```text
Movie A → processing
Movie B → queued
Movie C → queued
Movie D → queued
```

After Movie A completes:

```text
Movie B → processing
```

This prevents the Windows machine from being overwhelmed.

Implement a simple in-memory queue.

---

# 20. Prevent Duplicate Transcoding

If:

```text
Movie A
```

is already processing, a second watcher event must NOT start another FFmpeg process.

Maintain states such as:

```text
queued
processing
ready
failed
```

Before starting a job, verify that it is not already processing.

---

# 21. Atomic HLS Generation

Do not expose incomplete HLS output as ready.

Generate into a temporary directory:

```text
D:\MovieStream\hls\.tmp-interstellar-2014\
```

After successful FFmpeg completion:

```text
.tmp-interstellar-2014
        ↓
interstellar-2014
```

Only mark the movie:

```text
ready
```

after:

```text
master.m3u8
```

exists and FFmpeg completed successfully.

If FFmpeg fails:

```text
failed
```

and remove incomplete temporary output.

This prevents VLC from receiving broken playlists.

---

# 22. HLS Playlist

The master playlist should reference the available renditions.

Example concept:

```text
master.m3u8
    ↓
480p/playlist.m3u8
720p/playlist.m3u8
1080p/playlist.m3u8
```

The client should be able to select the appropriate quality.

---

# 23. Express Server

Use:

```text
Express
```

and listen on:

```text
0.0.0.0
```

Default port:

```text
5000
```

This is required so other devices on the LAN can access the server.

Do NOT bind only to:

```text
localhost
```

because Android TV/mobile devices would not be able to connect.

---

# 24. API Endpoints

Implement:

```http
GET /health
```

```http
GET /videos
```

```http
GET /videos/:id
```

```http
GET /videos/:id/play
```

HLS:

```http
GET /hls/:id/master.m3u8
```

and all generated HLS assets:

```text
/hls/:id/480p/playlist.m3u8
/hls/:id/480p/segment_000.ts
...
```

---

# 25. GET /health

Example:

```json
{
  "status": "ok",
  "movies": 10,
  "transcoding": 1,
  "queued": 2
}
```

HTTP status:

```text
200
```

---

# 26. GET /videos

Return discovered movies.

Example:

```json
[
  {
    "id": "interstellar-2014",
    "title": "Interstellar",
    "filename": "Interstellar (2014).mkv",
    "status": "ready",
    "durationSeconds": 10140,
    "width": 1920,
    "height": 1080,
    "videoCodec": "h264",
    "audioCodec": "aac",
    "playUrl": "/videos/interstellar-2014/play"
  }
]
```

Do not expose unnecessary internal filesystem details such as:

```text
D:\Movies\...
```

in normal API responses.

---

# 27. GET /videos/:id

Return movie information.

Example:

```json
{
  "id": "interstellar-2014",
  "title": "Interstellar",
  "status": "ready",
  "durationSeconds": 10140,
  "width": 1920,
  "height": 1080,
  "playUrl": "/videos/interstellar-2014/play"
}
```

If not found:

```http
404
```

with:

```json
{
  "error": "Movie not found"
}
```

---

# 28. GET /videos/:id/play

This is the primary playback endpoint.

Example:

```http
GET /videos/interstellar-2014/play
```

If ready:

```http
302
```

redirect to:

```text
/hls/interstellar-2014/master.m3u8
```

VLC should follow the redirect.

If the movie is still processing:

```http
409
```

Example:

```json
{
  "error": "Movie is still being processed",
  "status": "processing"
}
```

If queued:

```http
409
```

If failed:

```http
500
```

If movie doesn't exist:

```http
404
```

---

# 29. Important Playback Behavior

Do not redirect to an HLS playlist until:

```text
master.m3u8
```

exists and the movie has successfully completed transcoding.

Do not expose temporary HLS directories.

---

# 30. Static HLS Serving

Serve:

```text
D:\MovieStream\hls
```

through:

```text
/hls
```

Use Express static middleware or an equivalent secure implementation.

Set correct content types.

For:

```text
.m3u8
```

use:

```text
application/vnd.apple.mpegurl
```

For:

```text
.ts
```

use:

```text
video/mp2t
```

Add appropriate cache headers.

Playlists should not be aggressively cached.

Segments can be cached.

---

# 31. Path Traversal Security

Even though this is a home LAN application, implement safe path handling.

A request such as:

```text
/hls/../../some-file
```

must never allow access outside:

```text
D:\MovieStream\hls
```

Do not construct arbitrary filesystem paths directly from unchecked request parameters.

Validate movie IDs.

Use path resolution and verify the resulting path remains inside the HLS root.

---

# 32. No Direct Movie File Endpoint

Do NOT expose:

```text
D:\Movies
```

through Express static middleware.

Do not create:

```text
GET /movies/:filename
```

unless explicitly requested later.

The intended playback mechanism is:

```text
HLS
```

not direct filesystem access.

---

# 33. VLC Compatibility

The following should work:

```text
VLC Android
VLC Android TV
VLC Windows
```

Example URL:

```text
http://192.168.1.100:5000/videos/interstellar-2014/play
```

VLC should follow:

```text
/play
   ↓
/hls/interstellar-2014/master.m3u8
   ↓
quality playlist
   ↓
.ts segments
```

---

# 34. LAN Access

The server must listen on:

```text
0.0.0.0:5000
```

The PC might have an IP such as:

```text
192.168.1.100
```

Therefore:

```text
http://192.168.1.100:5000/videos
```

must be accessible from devices connected to the same home network.

Do not assume the IP address is always:

```text
192.168.1.100
```

Document how to find the actual IP using:

```cmd
ipconfig
```

---

# 35. Windows Firewall Documentation

The README must explain that Windows Firewall may block port 5000.

Provide instructions to allow inbound TCP:

```text
5000
```

for the private/home network.

Do not automatically weaken the firewall without user permission.

---

# 36. Logging

Implement a simple logger.

Log:

```text
[INFO]
[WARN]
[ERROR]
```

Examples:

```text
[INFO] Movie scanner started
[INFO] Found 5 movies
[INFO] New movie detected: Interstellar (2014).mkv
[INFO] Queued transcoding: interstellar-2014
[INFO] FFmpeg started: interstellar-2014
[INFO] FFmpeg completed: interstellar-2014
[ERROR] FFmpeg failed: ...
```

Do not log sensitive information.

---

# 37. Error Handling

Implement centralized Express error handling.

Do not allow uncaught errors to crash the server.

Handle:

- invalid movie ID
- movie not found
- FFmpeg unavailable
- ffprobe unavailable
- invalid media
- filesystem errors
- permission errors
- transcoding failures
- missing HLS files
- malformed requests

Return useful HTTP status codes.

---

# 38. Graceful Shutdown

Handle:

```text
SIGINT
SIGTERM
```

On shutdown:

1. Stop accepting new requests.
2. Stop the watcher.
3. Do not start new transcoding jobs.
4. Gracefully terminate active FFmpeg process if possible.
5. Close the HTTP server.
6. Exit cleanly.

Do not leave zombie FFmpeg processes.

---

# 39. Restart Behavior

There is no database.

Therefore on restart:

```text
server starts
    ↓
scan D:\Movies
    ↓
check HLS output
    ↓
if valid master.m3u8 exists
    ↓
mark ready
```

If HLS output is incomplete:

```text
delete invalid output
    ↓
queue transcoding
```

If the source movie was deleted:

```text
remove stale HLS
```

---

# 40. Existing HLS Detection

Before transcoding:

```text
D:\MovieStream\hls\<movie-id>\master.m3u8
```

should be checked.

If it exists and is valid:

```text
status = ready
```

Do not regenerate unnecessarily.

However, detect stale HLS.

A simple initial strategy:

Store a lightweight metadata file:

```text
metadata.json
```

inside the generated HLS directory.

Example:

```json
{
  "sourcePath": "D:\\Movies\\Interstellar (2014).mkv",
  "sourceSizeBytes": 21474836480,
  "sourceModifiedTime": 1757000000000,
  "generatedAt": "2026-09-06T12:00:00.000Z"
}
```

If source size or modified time changes:

```text
HLS is stale
```

and regenerate.

---

# 41. Automatic Regeneration

If:

```text
D:\Movies\Interstellar (2014).mkv
```

is replaced or modified:

```text
source changed
    ↓
old HLS becomes stale
    ↓
queue regeneration
```

Do not overwrite a currently working HLS directory until new generation succeeds.

Use temporary output.

---

# 42. FFmpeg Process Management

The FFmpeg service must:

- spawn FFmpeg
- capture stderr
- capture exit code
- detect process errors
- support cancellation
- expose progress if practical
- reject on non-zero exit
- clean temporary output after failure

FFmpeg normally outputs useful progress information through stderr.

Parse basic progress where practical, but do not make progress parsing a blocker for the first working version.

---

# 43. FFmpeg Command Requirements

Construct the FFmpeg command using an argument array.

Do NOT generate:

```text
ffmpeg "input" ... 
```

as one shell command string.

Use:

```typescript
spawn("ffmpeg", [
  "-i",
  inputPath,
  ...
]);
```

This must work with filenames containing:

- spaces
- parentheses
- apostrophes
- brackets
- hyphens
- Unicode characters

---

# 44. Audio Handling

For the first version:

```text
first valid audio stream
```

may be selected.

Use:

```text
0:a:0?
```

so files without audio do not immediately fail due to an invalid mandatory stream.

The implementation should be structured so multiple audio tracks can be added later.

Do not attempt to build a full audio/subtitle management system in version 1.

---

# 45. Subtitle Handling

Do not burn subtitles into the video in version 1.

Do not build subtitle extraction unless required for basic operation.

Design the code so subtitle support can be added later.

---

# 46. Multiple Audio Tracks

Do not fully implement adaptive multiple-audio HLS in version 1.

Document it as a future enhancement.

The initial goal is reliable:

```text
video + first audio track
```

playback.

---

# 47. Hardware Acceleration

Version 1 must use:

```text
libx264
```

for maximum compatibility.

However, design FFmpeg arguments so hardware encoding can be introduced later.

Future support may include:

```text
h264_nvenc
```

for NVIDIA GPUs.

Do NOT require NVIDIA GPU hardware for this project.

The application must work on a normal CPU-only Windows machine.

---

# 48. Important Performance Consideration

Do not transcode all movies simultaneously.

Default:

```env
MAX_CONCURRENT_TRANSCODES=1
```

A single large 1080p/4K movie may consume substantial CPU and disk resources.

Document this.

---

# 49. 4K Source Handling

If the source is:

```text
3840x2160
```

do not generate 4K HLS in version 1.

Generate:

```text
480p
720p
1080p
```

This keeps the project manageable.

Document that 4K passthrough / hardware transcoding can be implemented later.

---

# 50. API Response Design

Keep API responses clean.

Never expose:

```text
ffmpeg command
internal stack trace
Windows environment variables
absolute source path
```

to the client.

For errors, log detailed information server-side and return a safe message.

---

# 51. Testing

Add tests using a suitable TypeScript test framework.

Test at least:

## Slug generation

Input:

```text
Interstellar (2014).mkv
```

Expected:

```text
interstellar-2014
```

Input:

```text
The Dark Knight (2008).mp4
```

Expected:

```text
the-dark-knight-2008
```

## Supported extensions

Test:

```text
mp4
mkv
mov
avi
m4v
webm
```

## Unsupported extensions

Test:

```text
jpg
png
txt
srt
```

## Movie scanner

Create temporary test files and ensure only supported video files are returned.

## API

Test:

```text
GET /health
GET /videos
GET /videos/nonexistent
GET /videos/:id
```

Test `/play` behavior for:

```text
ready
processing
queued
failed
not found
```

---

# 52. Do Not Make Tests Depend on Real D:\Movies

Unit tests must not modify the user's actual movie directory.

Use temporary directories.

Do not delete or alter real user movie files during tests.

---

# 53. Development Scripts

`package.json` should provide:

```text
npm run dev
npm run build
npm start
npm test
```

Recommended:

```json
{
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "build": "tsc",
    "start": "node dist/server.js",
    "test": "vitest run"
  }
}
```

Use whatever test runner you choose, but it must work correctly with the TypeScript/ESM setup.

---

# 54. Build Validation

After implementation run:

```bash
npm install
npm run build
npm test
```

Fix every TypeScript/build/test error.

Do not stop after generating source files.

The final implementation must compile successfully.

---

# 55. Runtime Validation

If FFmpeg is available in the environment:

1. Create/use a small test video.
2. Run the application.
3. Confirm movie discovery.
4. Confirm ffprobe metadata.
5. Confirm FFmpeg generation.
6. Confirm `master.m3u8`.
7. Confirm HLS files.
8. Confirm HTTP endpoint.
9. Confirm `/play` redirect.

If a real movie file is available in:

```text
D:\Movies
```

you may use it for integration testing.

Do not modify or delete the original movie.

---

# 56. API Testing

Test:

```text
http://localhost:5000/health
```

Then:

```text
http://localhost:5000/videos
```

Then:

```text
http://localhost:5000/videos/<movie-id>
```

Then:

```text
http://localhost:5000/videos/<movie-id>/play
```

Confirm the final response redirects to:

```text
/hls/<movie-id>/master.m3u8
```

---

# 57. HLS Validation

After transcoding verify:

```text
master.m3u8
```

exists.

Also verify every playlist referenced by the master playlist exists.

Verify segment files referenced by playlists exist.

Do not mark a movie as:

```text
ready
```

if required HLS files are missing.

---

# 58. README

Create a complete README containing:

## Requirements

```text
Node.js 20+
FFmpeg
FFprobe
Windows 10/11
```

## Installation

```bash
npm install
```

## Configuration

Explain:

```text
.env
```

and:

```text
MOVIE_DIRECTORY
HLS_DIRECTORY
PORT
```

## FFmpeg installation

Explain how to install FFmpeg on Windows and verify:

```cmd
ffmpeg -version
ffprobe -version
```

## Running

Development:

```bash
npm run dev
```

Production:

```bash
npm run build
npm start
```

## Finding PC IP

Explain:

```cmd
ipconfig
```

## VLC

Example:

```text
http://192.168.1.100:5000/videos/interstellar-2014/play
```

Explain that the IP address must be replaced with the actual PC LAN IP.

## Android TV

Explain how to open the network stream in VLC.

## Windows Firewall

Explain how to allow TCP port 5000 for the private network.

## Troubleshooting

Cover:

- FFmpeg not found
- VLC cannot connect
- Android TV cannot connect
- Windows firewall
- movie stuck processing
- FFmpeg failure
- insufficient disk space
- high CPU usage
- HLS not generated

---

# 59. Example README Architecture

Document:

```text
                         D:\Movies
                            │
                            ▼
                    ┌───────────────┐
                    │ Chokidar      │
                    │ File Watcher  │
                    └───────┬───────┘
                            │
                            ▼
                    ┌───────────────┐
                    │ Movie Scanner │
                    └───────┬───────┘
                            │
                            ▼
                    ┌───────────────┐
                    │   ffprobe     │
                    │   Metadata    │
                    └───────┬───────┘
                            │
                            ▼
                    ┌───────────────┐
                    │ Transcode     │
                    │ Queue         │
                    └───────┬───────┘
                            │
                            ▼
                       FFmpeg
                            │
                            ▼
                    D:\MovieStream\hls
                            │
                            ▼
                    Express HTTP API
                            │
                     Home Network
                            │
                ┌───────────┴───────────┐
                ▼                       ▼
             VLC Mobile           VLC Android TV
```

---

# 60. No Database

Explicitly keep this architecture database-free.

Do not add MongoDB just because the project uses Node.js.

The data source is:

```text
D:\Movies
```

Generated data is:

```text
D:\MovieStream\hls
```

Runtime state is:

```text
in-memory
```

This is intentional.

---

# 61. Future Architecture

Document possible future improvements but DO NOT implement them now:

```text
React frontend
Movie posters
Search
Genres
TMDB metadata
Resume playback
Subtitle selection
Multiple audio tracks
Watch history
Favorites
Hardware transcoding
NVIDIA NVENC
Intel Quick Sync
AMD hardware encoding
4K support
Live transcoding
Thumbnail generation
Preview images
Remote access
Authentication
HTTPS
```

The current implementation should remain focused.

---

# 62. Important Design Principle

Separate these responsibilities:

```text
MovieScanner
    ↓
discovers movies


MovieRegistry
    ↓
tracks runtime movie state


FFprobeService
    ↓
reads media metadata


FFmpegService
    ↓
generates HLS


TranscodingQueue
    ↓
controls concurrent jobs


MovieWatcher
    ↓
detects filesystem changes


HlsService
    ↓
validates/generated HLS


VideoRoutes
    ↓
HTTP API


Server
    ↓
application bootstrap
```

Do not mix these responsibilities unnecessarily.

---

# 63. Security Requirements

Even though this is a home LAN application:

- validate all IDs
- prevent path traversal
- never expose arbitrary filesystem files
- never expose source movie paths through static HTTP
- never execute user-controlled shell strings
- use `spawn()` with argument arrays
- do not expose environment variables
- do not expose stack traces through HTTP
- do not allow arbitrary FFmpeg arguments through HTTP

---

# 64. Disk Space

HLS output can consume significant storage.

Document that:

```text
D:\MovieStream\hls
```

may become large.

Do not automatically delete HLS output for movies that still exist.

Only regenerate when necessary.

---

# 65. Idempotency

Running:

```text
npm start
```

multiple times after successful generation should NOT regenerate every movie.

The system must recognize existing valid HLS output.

Expected behavior:

```text
Server restart
    ↓
scan movies
    ↓
existing valid HLS
    ↓
status = ready
    ↓
NO transcoding
```

---

# 66. Handling Failed Transcoding

If FFmpeg fails:

```text
status = failed
```

Store a safe error message.

Remove temporary HLS files.

Do not mark the movie ready.

The server itself must remain running.

One bad movie must not crash the application.

---

# 67. Retry

Provide a reasonable retry mechanism.

For example, a failed movie may be retried when:

- the source file changes
- the server restarts and the HLS output is incomplete
- a future manual retry mechanism is added

Do not implement an infinite automatic retry loop.

---

# 68. Logging FFmpeg Errors

Capture FFmpeg stderr.

When FFmpeg fails, log enough information to troubleshoot:

```text
movie ID
exit code
FFmpeg stderr
```

Do not expose the complete FFmpeg diagnostic output through the public API.

---

# 69. Server Startup Sequence

Implement this startup flow:

```text
1. Load environment
        ↓
2. Validate configuration
        ↓
3. Validate FFmpeg
        ↓
4. Validate FFprobe
        ↓
5. Create directories
        ↓
6. Create MovieRegistry
        ↓
7. Scan D:\Movies
        ↓
8. Read metadata
        ↓
9. Detect existing HLS
        ↓
10. Queue missing/stale HLS
        ↓
11. Start file watcher
        ↓
12. Start Express server
```

---

# 70. New Movie Flow

```text
Movie copied into D:\Movies
        ↓
Chokidar detects "add"
        ↓
Wait until file stable
        ↓
Validate extension
        ↓
Generate movie ID
        ↓
ffprobe
        ↓
Add to registry
        ↓
Queue transcoding
        ↓
FFmpeg
        ↓
Temporary HLS directory
        ↓
Validate HLS
        ↓
Atomic rename
        ↓
status = ready
```

---

# 71. Playback Flow

```text
VLC
 │
 │ GET /videos/interstellar-2014/play
 ▼
Express
 │
 ▼
MovieRegistry
 │
 ├── not found → 404
 │
 ├── processing → 409
 │
 ├── failed → 500
 │
 └── ready
       │
       ▼
302 Redirect
       │
       ▼
/hls/interstellar-2014/master.m3u8
       │
       ▼
VLC reads HLS master
       │
       ├── 480p
       ├── 720p
       └── 1080p
       │
       ▼
VLC downloads segments
       │
       ▼
Movie playback
```

---

# 72. Important VLC Consideration

Do not assume every VLC version will handle every advanced HLS feature.

Keep the initial HLS implementation simple and compatible:

```text
H.264
+
AAC
+
MPEG-TS segments
+
standard HLS playlists
```

Do not introduce advanced codecs or fragmented MP4 unless necessary.

---

# 73. Development Philosophy

You are not merely generating boilerplate.

You must implement the project end-to-end.

Follow this process:

```text
Inspect environment
        ↓
Create project
        ↓
Install dependencies
        ↓
Implement modules
        ↓
Build
        ↓
Run tests
        ↓
Fix errors
        ↓
Run application
        ↓
Perform integration checks
        ↓
Fix issues
        ↓
Document
```

Do not stop at:

```text
"Here is the code."
```

The objective is a working application.

---

# 74. Antigravity Execution Rules

Before modifying anything:

1. Inspect the current directory.
2. Determine whether a project already exists.
3. Do not overwrite unrelated files.
4. If this is an empty directory, create the project.
5. Check Node.js version.
6. Check whether FFmpeg is available.
7. Check whether FFprobe is available.

Use appropriate shell commands to inspect the environment.

If FFmpeg is not installed, continue building the application but clearly report that runtime transcoding cannot be integration-tested until FFmpeg is installed.

Do NOT silently fake FFmpeg results.

---

# 75. Validation Commands

At the end, run:

```bash
npm install
npm run build
npm test
```

Then, if FFmpeg is available:

```bash
npm run dev
```

Verify:

```text
GET /health
GET /videos
```

If a test movie exists, verify:

```text
GET /videos/<id>/play
```

and confirm:

```text
master.m3u8
```

exists.

---

# 76. Expected Final Directory

After successful setup:

```text
movie-stream-server/
│
├── src/
│   ├── config/
│   │   └── env.ts
│   ├── types/
│   │   └── movie.ts
│   ├── services/
│   │   ├── movieScanner.ts
│   │   ├── movieRegistry.ts
│   │   ├── ffmpegService.ts
│   │   ├── transcodingQueue.ts
│   │   ├── hlsService.ts
│   │   └── movieWatcher.ts
│   ├── routes/
│   │   ├── healthRoutes.ts
│   │   └── videoRoutes.ts
│   ├── middleware/
│   │   └── errorHandler.ts
│   ├── utils/
│   │   ├── slug.ts
│   │   ├── filesystem.ts
│   │   └── logger.ts
│   └── server.ts
│
├── tests/
│
├── hls/
│
├── .env
├── .env.example
├── .gitignore
├── package.json
├── tsconfig.json
├── README.md
└── CLAUDE.md
```

Movies remain here:

```text
D:\Movies\
```

Generated HLS:

```text
D:\MovieStream\hls\
```

---

# 77. Final Acceptance Criteria

The project is considered complete ONLY when all applicable requirements below are satisfied.

## Application

- [ ] TypeScript compiles
- [ ] Tests pass
- [ ] Express starts
- [ ] Server listens on `0.0.0.0`
- [ ] `/health` works

## Movie discovery

- [ ] Existing movies are detected
- [ ] New movies are detected automatically
- [ ] Deleted movies are handled
- [ ] Unsupported files are ignored
- [ ] Incomplete file copies are not processed

## Metadata

- [ ] ffprobe is used
- [ ] Duration detected
- [ ] Resolution detected
- [ ] Video codec detected
- [ ] Audio codec detected

## Transcoding

- [ ] FFmpeg uses spawn
- [ ] Windows paths work
- [ ] Spaces in filenames work
- [ ] Parentheses in filenames work
- [ ] Concurrent jobs are limited
- [ ] Duplicate jobs are prevented
- [ ] Temporary output is used
- [ ] Failed jobs clean up
- [ ] Successful output is validated

## HLS

- [ ] `master.m3u8` generated
- [ ] 480p generated when appropriate
- [ ] 720p generated when appropriate
- [ ] 1080p generated when appropriate
- [ ] Aspect ratio preserved
- [ ] No unnecessary upscaling
- [ ] VLC-compatible HLS generated

## API

- [ ] `/videos`
- [ ] `/videos/:id`
- [ ] `/videos/:id/play`
- [ ] `/health`
- [ ] `/hls/...`

## Playback

- [ ] `/play` redirects to master playlist
- [ ] VLC can access the playlist
- [ ] HLS segments are accessible
- [ ] Android TV can connect over LAN

## Reliability

- [ ] Server survives FFmpeg failure
- [ ] Graceful shutdown implemented
- [ ] Restart detects existing HLS
- [ ] Stale HLS is detected
- [ ] Duplicate transcoding is prevented

## Security

- [ ] Path traversal prevented
- [ ] Arbitrary files cannot be downloaded
- [ ] Source movie directory is not exposed
- [ ] Shell injection avoided
- [ ] Internal paths not exposed unnecessarily

## Documentation

- [ ] Installation documented
- [ ] FFmpeg setup documented
- [ ] `.env` documented
- [ ] LAN setup documented
- [ ] VLC setup documented
- [ ] Android TV setup documented
- [ ] Windows Firewall documented
- [ ] Troubleshooting documented

---

# 78. Final Output Required From Antigravity

After completing implementation, provide a concise final report containing:

## 1. What was built

Summarize the architecture.

## 2. Files created/modified

List important files.

## 3. Commands

Show:

```bash
npm install
npm run dev
npm run build
npm test
```

## 4. Configuration

Show the required `.env` values.

## 5. LAN usage

Explain:

```text
ipconfig
```

and how to construct:

```text
http://<PC-IP>:5000/videos/<movie-id>/play
```

## 6. VLC usage

Give an exact VLC example.

## 7. Validation

Report:

```text
Build: PASS/FAIL
Tests: PASS/FAIL
FFmpeg: AVAILABLE/NOT AVAILABLE
FFprobe: AVAILABLE/NOT AVAILABLE
Server: PASS/FAIL
```

Do not claim something was tested if it was not actually tested.

---

# 79. Most Important Requirement

Build a **real, runnable implementation**, not a conceptual example.

If you encounter an error:

```text
diagnose
→ fix
→ rebuild
→ retest
```

Do not simply describe the error.

Do not leave TODOs for core functionality.

Do not replace real FFmpeg processing with mock implementations.

Do not add unnecessary technologies.

Keep the architecture simple:

```text
Filesystem
+
Node.js
+
TypeScript
+
Express
+
Chokidar
+
FFprobe
+
FFmpeg
+
HLS
+
VLC
```

The final result should be a reliable **home-network movie streaming server** where the user can simply place:

```text
D:\Movies\Movie Name (Year).mkv
```

into the movie directory and eventually play it from VLC using:

```text
http://<PC-IP>:5000/videos/<movie-id>/play
```

without uploading the movie through an application UI and without requiring a database or cloud service.