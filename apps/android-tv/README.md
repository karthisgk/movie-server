# Movie Server — Android TV App

Native Android TV app that connects to the [Home LAN Movie Streaming Server](../../README.md) and plays movies using ExoPlayer with VLC-like controls.

## Features

- 🎬 **Movie Browser** — Leanback TV UI with movie cards categorized by status (Ready, Processing, Failed)
- ▶️ **HLS Playback** — Streams directly from the movie server via ExoPlayer + HLS
- 🎵 **Audio Track Selection** — Switch between multiple audio tracks (D-pad UP or audio button)
- 💬 **Subtitle Selection** — Server-extracted `.vtt` subtitles + in-stream tracks (D-pad DOWN or subtitle button)
- ⏪⏩ **Seek** — 10-second forward/backward with D-pad LEFT/RIGHT
- ⚙️ **Settings** — Configure server host (IP) and port

## D-pad Controls (Player)

| Key | Action |
|-----|--------|
| CENTER / ENTER | Play / Pause |
| LEFT | Seek backward 10s |
| RIGHT | Seek forward 10s |
| UP | Audio track picker |
| DOWN | Subtitle picker |
| BACK | Exit player |

## Build & Install

### Prerequisites
- Android Studio Hedgehog or newer
- Android TV device or emulator (API 21+)
- Movie server running on the same LAN

### Steps

1. Open `apps/android-tv/` in Android Studio
2. Let Gradle sync (downloads dependencies)
3. Run `./gradlew assembleDebug`
4. Install APK:
   ```
   adb install app/build/outputs/apk/debug/app-debug.apk
   ```
5. Launch the app on your Android TV
6. Go to **Settings** and enter your server's IP address and port

## Default Server URL

```
http://192.168.0.10:5000
```

Change this in the app's Settings screen.

## Project Structure

```
apps/android-tv/
├── app/src/main/
│   ├── java/com/movieserver/tv/
│   │   ├── MainActivity.kt              ← Entry point
│   │   ├── MovieApp.kt                  ← Application class
│   │   ├── ui/
│   │   │   ├── browse/
│   │   │   │   ├── BrowseFragment.kt    ← Movie list (Leanback)
│   │   │   │   └── MovieCardPresenter.kt
│   │   │   ├── player/
│   │   │   │   ├── PlayerActivity.kt    ← Full-screen player
│   │   │   │   └── PlayerViewModel.kt
│   │   │   └── settings/
│   │   │       └── SettingsActivity.kt  ← Server config
│   │   ├── data/
│   │   │   ├── api/                     ← Retrofit
│   │   │   ├── model/                   ← Data classes
│   │   │   └── repository/
│   │   └── utils/
│   │       └── ServerUrlManager.kt      ← SharedPrefs host/port
│   └── res/                             ← Layouts, drawables, strings
```

## Server-Side Subtitle Extraction

The movie server now exposes subtitle tracks extracted from source files:

```http
GET /videos/:id/subtitles
```

Response:
```json
[
  { "index": 0, "trackIndex": 0, "language": "eng", "label": "English", "url": "/hls/movie-id/subtitles/sub_0_eng.vtt" }
]
```

The Android TV app fetches these and loads them as external subtitle sources in ExoPlayer.
