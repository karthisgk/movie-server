# Multi-Audio Transcoding & Scrubbing Fix Context

This document details the background, investigation, attempts, root causes, and current code state for fixing the multi-audio track transcoding and video player scrubbing/seeking regression in `movie-server`.

---

## 1. Problem Statement

### Initial Bug Report
- Input video files with multiple audio streams (e.g., `sardar 2.mkv`, containing Stream 1 = Hindi, Stream 2 = Tamil) were transcoded into HLS output with **only 1 audio track (Hindi)**. The Tamil audio track was missing.
- **Requirement**: Preserve all audio tracks from source videos so users can select and switch audio tracks in both the **Web Player (`hls.js`)** and **Android TV (`ExoPlayer`)**.

### Subsequent Regression
- After enabling multi-audio transcoding, fast-forwarding, seeking, or jumping to different timestamps using the seekbar/scrubber in the Web Video Player caused the video to **freeze and hang in non-stop loading** (`waiting` / buffering state).
- In contrast, the `master` branch (which only transcoded 1 audio track) allowed fast, instant scrubbing without freezing.

---

## 2. Codebase Overview

| Component | Language / Framework | Primary Files |
|---|---|---|
| **Backend Transcoder** | Node.js + TypeScript + FFmpeg / Worker Threads | [`src/services/ffmpegService.ts`](file:///c:/Users/KARTHICK%20SG/non_share/movies/movie-server/src/services/ffmpegService.ts), [`src/services/transcodeWorker.ts`](file:///c:/Users/KARTHICK%20SG/non_share/movies/movie-server/src/services/transcodeWorker.ts) |
| **Media Prober** | FFprobe | `getMediaInfo()` in [`ffmpegService.ts`](file:///c:/Users/KARTHICK%20SG/non_share/movies/movie-server/src/services/ffmpegService.ts) |
| **Web Frontend** | React + TypeScript + `hls.js` | [`apps/web/src/components/VideoPlayer.tsx`](file:///c:/Users/KARTHICK%20SG/non_share/movies/movie-server/apps/web/src/components/VideoPlayer.tsx) |
| **Android TV App** | Kotlin + ExoPlayer (Media3) | [`apps/android-tv/app/src/main/java/com/movieserver/tv/ui/player/PlayerActivity.kt`](file:///c:/Users/KARTHICK%20SG/non_share/movies/movie-server/apps/android-tv/app/src/main/java/com/movieserver/tv/ui/player/PlayerActivity.kt) |

---

## 3. Investigation & Attempts Summary

### Attempt 1: Multiplexing All Audio Streams in Single MPEG-TS Container (`-map 0:v:0 -map 0:a?`)

- **Implementation**: Changed FFmpeg mapping in `transcodeWorker.ts` from `-map 0:a:0?` to `-map 0:a?`.
- **Generated Output**: Produced MPEG-TS `.ts` files containing 1 Video PID (`0x100`) + 2 Audio PIDs (Hindi `0x101` + Tamil `0x102`).
- **Symptom**: Fast-forwarding/scrubbing in `hls.js` froze immediately and hung in non-stop loading.
- **Root Cause Analysis**:
  - `hls.js`'s `TSDemuxer` (`tsdemuxer.ts`) has a single `_audioTrack` instance per demuxer session.
  - When `TSDemuxer` demuxed an MPEG-TS segment containing 2 audio PIDs, it pushed AAC samples from **both** audio PIDs into the single MSE (MediaSource Extensions) Audio SourceBuffer at identical PTS timestamps.
  - Interleaving two different audio streams at identical timestamps corrupted the MSE audio buffer ranges. When seeking, HTML5 `<video>` could not resolve the overlapping audio samples and stalled on `waiting` indefinitely.

---

### Attempt 2: Hybrid In-Stream Default Audio + Alternate Audio URI

- **Implementation**:
  - Main video profile (`1080p/playlist.m3u8`) was transcoded with video + default audio (`-map 0:v:0 -map 0:a:0?`).
  - Track 1 (Tamil) was extracted as a separate HLS audio playlist (`audio_1/playlist.m3u8`).
  - In `master.m3u8`:
    ```m3u8
    #EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio-tracks",NAME="Hindi",DEFAULT=YES,AUTOSELECT=YES
    #EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio-tracks",NAME="Tamil",DEFAULT=NO,AUTOSELECT=YES,URI="audio_1/playlist.m3u8"
    ```
- **Symptom**: Scrubbing on default Track 0 (Hindi) still froze in `hls.js`.
- **Root Cause Analysis**:
  - `hls.js` does **not** support mixed in-stream and alternate audio in the same `#EXT-X-MEDIA` group.
  - When `#EXT-X-MEDIA:TYPE=AUDIO` is linked via `AUDIO="audio-tracks"`, `hls.js` activates `AudioStreamController`.
  - Because Track 0 had no `URI` attribute, `AudioStreamController` had `details: null` for Track 0.
  - On seek/scrub, `AudioStreamController` entered a `WAITING_TRACK` state waiting for playlist manifest updates for Track 0 that would never arrive.

---

### Attempt 3: All Alternate Audio Renditions with URIs (`audio_0`, `audio_1`)

- **Implementation**:
  - Video profiles (`1080p`, `720p`, `480p`) encoded video-only (`-map 0:v:0 -an`).
  - Audio tracks (`audio_0`, `audio_1`) extracted as standalone HLS audio playlists.
  - `master.m3u8` declared `URI` attributes for **every** audio rendition:
    ```m3u8
    #EXTM3U
    #EXT-X-VERSION:3

    #EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio-tracks",NAME="Hindi",LANGUAGE="hin",DEFAULT=YES,AUTOSELECT=YES,URI="audio_0/playlist.m3u8"
    #EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio-tracks",NAME="Tamil",LANGUAGE="tam",DEFAULT=NO,AUTOSELECT=YES,URI="audio_1/playlist.m3u8"

    #EXT-X-STREAM-INF:BANDWIDTH=5128000,RESOLUTION=1920x1080,CODECS="avc1.42e01e,mp4a.40.2",AUDIO="audio-tracks"
    1080p/playlist.m3u8
    ```
- **Current Status**: User reports issue still persists during seeking/scrubbing testing in their web environment.

---

## 4. Current File Modifications (on `fix-audio-track` branch)

1. **[`src/services/transcodeWorker.ts`](file:///c:/Users/KARTHICK%20SG/non_share/movies/movie-server/src/services/transcodeWorker.ts)**:
   - Evaluates `hasMultipleAudio` from `audioTracks`.
   - Transcodes video profiles with `-an` when `hasMultipleAudio` is true.
   - Extracts `audio_0`, `audio_1`... into `<finalDir>/audio_${i}/playlist.m3u8`.

2. **[`src/services/ffmpegService.ts`](file:///c:/Users/KARTHICK%20SG/non_share/movies/movie-server/src/services/ffmpegService.ts)**:
   - Probes all audio streams in `getMediaInfo()` via `output.streams.filter(s => s.codec_type === 'audio')`.
   - Generates `#EXT-X-MEDIA` tags with `URI="audio_${i}/playlist.m3u8"` for all audio renditions in `writeMasterPlaylist()`.

3. **[`apps/web/src/components/VideoPlayer.tsx`](file:///c:/Users/KARTHICK%20SG/non_share/movies/movie-server/apps/web/src/components/VideoPlayer.tsx)**:
   - Listens to `hls.on(Hls.Events.AUDIO_TRACKS_UPDATED)`.
   - Renders audio track picker in player settings overlay.

---

## 5. Next Steps / Recommendations for Investigation

For another AI agent or developer continuing this task:

1. **Check `hls.js` Event Logs in Browser Console**:
   - Open Chrome DevTools Console during scrubbing/seeking.
   - Look for `hls.js` warnings/errors: `bufferStalled`, `fragParsingError`, `bufferNudgeOnStall`, `audioTrackChange`, `bufferAppendError`.

2. **Verify Audio/Video Fragment Timestamp Synchronization**:
   - When video is video-only (`1080p/segment_000.ts`) and audio is separate (`audio_0/segment_000.ts`), check if FFmpeg's video start PTS matches audio start PTS.
   - If video segment start PTS is `1.48s` and audio segment start PTS is `0.00s` or `1.46s`, `hls.js`'s `BufferController` may stall waiting for aligned MSE timestamps.

3. **Consider fMP4 Container (`.m4s` / mp4) instead of MPEG-TS (`.ts`)**:
   - MPEG-TS segmenting with independent audio/video streams in `hls.js` often suffers from timestamp drift.
   - FFmpeg flag `-hls_segment_type fmp4` with `-hls_fmp4_init_filename init.mp4` produces fragmented MP4 segments, which `hls.js` demuxes with higher precision.

4. **Test Standalone FFmpeg Muxer Multi-Audio (`-var_stream_map`)**:
   - FFmpeg's `hls` muxer supports `-var_stream_map`:
     `-var_stream_map "v:0,agroup:audio,default:yes a:0,agroup:audio,name:Hindi a:1,agroup:audio,name:Tamil"`
   - Allowing FFmpeg's HLS muxer to output playlists natively ensures exact segment duration and PTS alignment across video and audio renditions.
