# Home LAN Movie Streaming Server

Stream your personal movie collection over your home network to VLC on any device.

```
                     C:\Users\...\Stream contents
                              │
                              ▼
                      ┌───────────────┐
                      │   Chokidar    │
                      │  File Watcher │
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
                      │  Transcode    │
                      │    Queue      │
                      └───────┬───────┘
                              │
                              ▼
                           FFmpeg
                              │
                              ▼
                    hls\<movie-id>\master.m3u8
                              │
                              ▼
                      Express HTTP API
                              │
                       Home Network
                              │
              ┌───────────────┴───────────────┐
              ▼                               ▼
         VLC Mobile                   VLC Android TV
```

---

## Requirements

| Requirement | Version |
|-------------|---------|
| Node.js | 20+ |
| FFmpeg | Any recent build |
| FFprobe | Included with FFmpeg |
| Windows | 10 or 11 |

---

## Installation

```bash
npm install
```

---

## Configuration

Copy `.env.example` to `.env` and edit the values:

```bash
copy .env.example .env
```

Key settings:

| Variable | Description | Default |
|----------|-------------|---------|
| `MOVIE_DIRECTORY` | Where your movie files live | `D:\Movies` |
| `HLS_DIRECTORY` | Where HLS output is written | `D:\MovieStream\hls` |
| `PORT` | HTTP port | `5000` |
| `FFMPEG_PATH` | Full path to ffmpeg.exe | `ffmpeg` |
| `FFPROBE_PATH` | Full path to ffprobe.exe | `ffprobe` |
| `MAX_CONCURRENT_TRANSCODES` | Parallel FFmpeg jobs | `1` |
| `AUTO_TRANSCODE` | Auto-transcode on discovery | `true` |

---

## FFmpeg Installation (Windows)

1. Download FFmpeg from https://ffmpeg.org/download.html  
   Choose **Windows builds** → **gpl** variant (includes all codecs).

2. Extract to a location like `C:\ffmpeg\`

3. Either:
   - **Option A:** Add `C:\ffmpeg\bin` to your Windows PATH environment variable, then set:
     ```env
     FFMPEG_PATH=ffmpeg
     FFPROBE_PATH=ffprobe
     ```
   - **Option B:** Set the full path in `.env`:
     ```env
     FFMPEG_PATH=C:\ffmpeg\bin\ffmpeg.exe
     FFPROBE_PATH=C:\ffmpeg\bin\ffprobe.exe
     ```

4. Verify:
   ```cmd
   ffmpeg -version
   ffprobe -version
   ```

---

## Running

### Development (with auto-reload)

```bash
npm run dev
```

### Production

```bash
npm run build
npm start
```

### Tests

```bash
npm test
```

---

## Finding Your PC's LAN IP

Run in Command Prompt:

```cmd
ipconfig
```

Look for **IPv4 Address** under your active network adapter (usually **Ethernet** or **Wi-Fi**):

```
IPv4 Address. . . . . . . . . . . : 192.168.1.100
```

---

## API Reference

| Endpoint | Description |
|----------|-------------|
| `GET /health` | Server status |
| `GET /videos` | List all movies |
| `GET /videos/:id` | Single movie details |
| `GET /videos/:id/play` | Playback — redirects to HLS |
| `GET /hls/:id/master.m3u8` | HLS master playlist |

### Example

```bash
curl http://localhost:5000/health
curl http://localhost:5000/videos
```

---

## VLC Playback

### VLC on any device (Windows, Android, Android TV)

1. Open VLC
2. Go to **Media → Open Network Stream** (or **Stream** on Android)
3. Enter the URL:

```
http://192.168.1.100:5000/videos/interstellar-2014/play
```

> Replace `192.168.1.100` with your PC's actual LAN IP address (found via `ipconfig`).  
> Replace `interstellar-2014` with the movie ID from `GET /videos`.

VLC will:
1. Follow the HTTP 302 redirect
2. Receive the HLS master playlist
3. Auto-select the best quality (480p / 720p / 1080p)
4. Stream .ts segments directly

### Android TV — VLC App

1. Install **VLC for Android** from Google Play
2. Open VLC → **Browse** → **Local network** — OR —
3. Use **Stream** tab → enter the URL above

---

## Movie Discovery

Simply drop your movie files into the configured `MOVIE_DIRECTORY`:

```
C:\Users\...\Stream contents\
├── Interstellar (2014).mkv
├── Inception (2010).mp4
└── The Dark Knight (2008).mp4
```

**Supported formats:** `.mp4`, `.mkv`, `.mov`, `.avi`, `.m4v`, `.webm`

The server will:
1. Detect the file (via Chokidar watcher)
2. Wait until the copy is complete (stability check)
3. Run ffprobe to extract metadata
4. Queue HLS transcoding (FFmpeg)
5. Make the movie available at `/videos/:id/play`

> **Note:** Transcoding a 2-hour 1080p movie may take 30–60 minutes on a typical CPU. The server remains fully operational for already-transcoded movies during this time.

---

## HLS Quality Profiles

| Profile | Resolution | Video Bitrate | Audio |
|---------|-----------|---------------|-------|
| 480p | 854×480 | 1.2 Mbps | AAC 128 kbps |
| 720p | 1280×720 | 2.8 Mbps | AAC 128 kbps |
| 1080p | 1920×1080 | 5.0 Mbps | AAC 128 kbps |

The server automatically skips profiles that would require upscaling. For example, a 720p source generates 480p + 720p only.

Aspect ratio is always preserved — widescreen (21:9) movies remain widescreen.

---

## Disk Space

HLS output can be large. A 2-hour 1080p movie generates approximately:

| Profile | Approximate Size |
|---------|-----------------|
| 480p | ~3 GB |
| 720p | ~7 GB |
| 1080p | ~12 GB |

All HLS files are stored in `HLS_DIRECTORY`. You can safely delete a movie's HLS folder — it will be regenerated on the next server start (or when the file is re-detected).

---

## Windows Firewall

By default, Windows Firewall may block incoming connections on port 5000.

To allow LAN access:

1. Open **Windows Defender Firewall with Advanced Security**
2. Click **Inbound Rules → New Rule**
3. Select **Port** → **TCP** → Specific port: `5000`
4. Select **Allow the connection**
5. Check **Private** (home/work networks)
6. Name it: `Movie Stream Server`

Or use Command Prompt (run as Administrator):

```cmd
netsh advfirewall firewall add rule name="Movie Stream Server" dir=in action=allow protocol=TCP localport=5000 profile=private
```

---

## Troubleshooting

### FFmpeg not found
```
FFmpeg validation failed: FFmpeg could not be started at "ffmpeg"
```
→ Install FFmpeg and set `FFMPEG_PATH` in `.env` to the full path of `ffmpeg.exe`.

### VLC cannot connect
- Check that the server is running (`npm run dev`)
- Confirm your PC's LAN IP via `ipconfig`
- Confirm Windows Firewall allows port 5000 (see above)
- Ensure VLC and the server PC are on the same Wi-Fi/LAN network

### Android TV cannot connect
- Same network check as above
- Try the IP URL from a browser first: `http://<PC-IP>:5000/health`
- If browser works but VLC doesn't, check VLC network settings

### Movie stuck in "processing"
- Transcoding a large file takes time — check the server console for progress logs
- If the server was killed mid-transcode, restart it — temp files are cleaned on startup and transcoding will re-queue

### High CPU usage
- This is expected during transcoding (`libx264` is CPU-intensive)
- Set `MAX_CONCURRENT_TRANSCODES=1` (default) to limit to one job at a time
- Transcoding only runs once per movie; subsequent server restarts detect existing HLS

### HLS not generated / movie shows "failed"
- Check server logs for FFmpeg error details
- Verify the source file is a valid video (try opening it in VLC directly)
- Check available disk space on the `HLS_DIRECTORY` drive

### Insufficient disk space
- HLS output can be large (see Disk Space section above)
- Check free space: `dir C:\Users\...\Stream contents\hls`
- Delete stale HLS directories manually if needed

---

## Future Enhancements (Not Implemented)

- React web frontend with movie browser
- Movie posters from TMDB API
- Resume playback / watch history
- Multiple audio track selection
- Subtitle extraction and selection
- Hardware transcoding (NVIDIA NVENC, Intel Quick Sync)
- 4K HLS output
- Remote access with HTTPS and authentication
- Live transcoding (transcode on-demand instead of ahead of time)
