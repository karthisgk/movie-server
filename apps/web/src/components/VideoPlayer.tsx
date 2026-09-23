import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import Hls from 'hls.js';
import {
  ArrowLeft,
  Check,
  ChevronRight,
  Loader2,
  Maximize,
  Minimize,
  Pause,
  PictureInPicture2,
  Play,
  RotateCcw,
  Settings,
  SkipBack,
  SkipForward,
  Subtitles,
  Volume1,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { PublicMovie, SubtitleTrack } from '../types';
import { cleanTitle, formatClock, isFinished } from '../lib/format';
import { getProgress, saveProgress } from '../lib/progressStore';

interface VideoPlayerProps {
  movie: PublicMovie;
  onClose: () => void;
}

interface QualityLevel {
  id: number;
  height: number;
  name: string;
}

interface AudioTrackOption {
  id: number;
  name: string;
  lang?: string;
}

type MenuView = 'none' | 'root' | 'speed' | 'quality' | 'subs' | 'audio';

const SPEED_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 2];
const CONTROLS_HIDE_MS = 3200;

function speedLabel(rate: number): string {
  return rate === 1 ? 'Normal' : `${rate}x`;
}

// ─── Seek bar ────────────────────────────────────────────────────────────────

interface SeekBarProps {
  currentTime: number;
  duration: number;
  bufferedEnd: number;
  onScrub: (time: number) => void;
  onCommit: () => void;
}

const SeekBar: React.FC<SeekBarProps> = ({
  currentTime,
  duration,
  bufferedEnd,
  onScrub,
  onCommit,
}) => {
  const barRef = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const [hover, setHover] = useState<{ ratio: number; time: number } | null>(null);

  const ratioFromX = useCallback((clientX: number): number => {
    const el = barRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0) return 0;
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  }, []);

  const safeDuration = duration > 0 ? duration : 0;
  const played = safeDuration ? Math.min(1, currentTime / safeDuration) : 0;
  const buffered = safeDuration ? Math.min(1, bufferedEnd / safeDuration) : 0;

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setDragging(true);
    onScrub(ratioFromX(e.clientX) * safeDuration);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const ratio = ratioFromX(e.clientX);
    setHover({ ratio, time: ratio * safeDuration });
    if (dragging) onScrub(ratio * safeDuration);
  };

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    setDragging(false);
    if (dragging) onCommit();
  };

  return (
    <div className="seekbar-wrap">
      <div
        ref={barRef}
        className={`seekbar ${dragging ? 'is-dragging' : ''}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerLeave={() => setHover(null)}
      >
        <div className="seekbar-buffered" style={{ width: `${buffered * 100}%` }} />
        <div className="seekbar-played" style={{ width: `${played * 100}%` }} />
        <div className="seekbar-knob" style={{ left: `${played * 100}%` }} />
      </div>

      {hover && safeDuration > 0 && (
        <div className="seekbar-tooltip" style={{ left: `${hover.ratio * 100}%` }}>
          {formatClock(hover.time)}
        </div>
      )}
    </div>
  );
};

// ─── Menu row ────────────────────────────────────────────────────────────────

const MenuRow: React.FC<{
  label: string;
  value?: string;
  active?: boolean;
  onClick?: () => void;
}> = ({ label, value, active, onClick }) => (
  <button className={`menu-row ${active ? 'is-active' : ''}`} onClick={onClick} type="button">
    <span className="menu-row-label">{label}</span>
    <span className="menu-row-value">
      {value}
      {active ? <Check size={16} /> : value === undefined ? <ChevronRight size={16} /> : null}
    </span>
  </button>
);

// ─── Player ──────────────────────────────────────────────────────────────────

export const VideoPlayer: React.FC<VideoPlayerProps> = ({ movie, onClose }) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const hideTimerRef = useRef<number | null>(null);
  const clickTimerRef = useRef<number | null>(null);
  const menuRef = useRef<MenuView>('none');
  const resumedRef = useRef(false);

  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(true);
  const [isEnded, setIsEnded] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(movie.durationSeconds ?? 0);
  const [bufferedEnd, setBufferedEnd] = useState(0);

  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);

  const [levels, setLevels] = useState<QualityLevel[]>([]);
  const [levelIndex, setLevelIndex] = useState(-1);
  const [activeLevel, setActiveLevel] = useState(-1);
  const [rate, setRate] = useState(1);

  const [subs, setSubs] = useState<SubtitleTrack[]>([]);
  const [subIndex, setSubIndex] = useState(-1);

  const [audioTracks, setAudioTracks] = useState<AudioTrackOption[]>([]);
  const [audioTrackIndex, setAudioTrackIndex] = useState(-1);

  const [seekFeedback, setSeekFeedback] = useState<{ type: 'forward' | 'rewind'; id: number } | null>(null);

  const [showControls, setShowControls] = useState(true);
  const [menu, setMenu] = useState<MenuView>('none');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isPip, setIsPip] = useState(false);
  const [showRemaining, setShowRemaining] = useState(false);
  const [resumeNotice, setResumeNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Keep a ref of the open menu so timer callbacks see the latest value.
  useEffect(() => {
    menuRef.current = menu;
  }, [menu]);

  const poke = useCallback(() => {
    setShowControls(true);
    if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
    hideTimerRef.current = window.setTimeout(() => {
      const video = videoRef.current;
      if (video && !video.paused && menuRef.current === 'none') {
        setShowControls(false);
      }
    }, CONTROLS_HIDE_MS);
  }, []);

  const closeMenu = useCallback(() => {
    setMenu('none');
    poke();
  }, [poke]);

  const openMenu = useCallback((view: MenuView) => {
    if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
    setShowControls(true);
    setMenu(view);
  }, []);

  // ─── Body scroll lock ──────────────────────────────────────────────────────
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  // ─── HLS / source setup ────────────────────────────────────────────────────
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    resumedRef.current = false;
    setError(null);
    setIsEnded(false);
    setIsBuffering(true);
    setLevels([]);
    setLevelIndex(-1);
    setActiveLevel(-1);
    setCurrentTime(0);
    setBufferedEnd(0);
    setDuration(movie.durationSeconds ?? 0);

    const src = movie.playUrl;

    if (Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        backBufferLength: 90,
      });
      hlsRef.current = hls;
      hls.loadSource(src);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, (_event, data) => {
        setLevels(
          data.levels.map((level, index) => ({
            id: index,
            height: level.height ?? 0,
            name: level.height
              ? `${level.height}p`
              : `${Math.round((level.bitrate ?? 0) / 1000)} kbps`,
          })),
        );
        void video.play().catch(() => {});
      });

      hls.on(Hls.Events.LEVEL_SWITCHED, (_event, data) => {
        setActiveLevel(data.level);
      });

      hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, (_event, data) => {
        const tracks = data.audioTracks || [];
        if (tracks.length > 0) {
          setAudioTracks(
            tracks.map((t, index) => ({
              id: t.id ?? index,
              name: t.name || t.lang || `Track ${index + 1}`,
              lang: t.lang,
            })),
          );
          setAudioTrackIndex(hls.audioTrack);
        }
      });

      hls.on(Hls.Events.AUDIO_TRACK_SWITCHED, (_event, data) => {
        setAudioTrackIndex(data.id);
      });

      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal) return;
        switch (data.type) {
          case Hls.ErrorTypes.NETWORK_ERROR:
            hls.startLoad();
            break;
          case Hls.ErrorTypes.MEDIA_ERROR:
            hls.recoverMediaError();
            break;
          default:
            setError('Playback failed. The stream may be unavailable.');
            setIsBuffering(false);
            hls.destroy();
        }
      });

      return () => {
        hls.destroy();
        hlsRef.current = null;
      };
    }

    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = src;
      void video.play().catch(() => {});
      return () => {
        video.removeAttribute('src');
        video.load();
      };
    }

    setError('HLS playback is not supported in this browser.');
    setIsBuffering(false);
    return undefined;
  }, [movie.id, movie.playUrl]);

  // ─── Subtitle track discovery ──────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setSubs([]);
    setSubIndex(-1);
    fetch(`/videos/${movie.id}/subtitles`)
      .then((res) => (res.ok ? res.json() : []))
      .then((data: SubtitleTrack[]) => {
        if (!cancelled && Array.isArray(data)) setSubs(data);
      })
      .catch(() => {
        /* Subtitles are optional. */
      });
    return () => {
      cancelled = true;
    };
  }, [movie.id]);

  // ─── Native media event wiring ─────────────────────────────────────────────
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const applyResume = () => {
      if (resumedRef.current) return;
      resumedRef.current = true;
      const mediaDuration = video.duration || movie.durationSeconds || 0;
      setDuration(mediaDuration);
      const stored = getProgress(movie.id);
      if (!stored || stored.time < 15 || isFinished(stored.time, mediaDuration)) return;
      try {
        video.currentTime = stored.time;
        setCurrentTime(stored.time);
        setResumeNotice(`Resuming from ${formatClock(stored.time)}`);
        window.setTimeout(() => setResumeNotice(null), 4000);
      } catch {
        /* Seek can fail if metadata is not ready yet. */
      }
    };

    const onPlay = () => {
      setIsPlaying(true);
      setIsEnded(false);
      poke();
    };
    const onPause = () => {
      setIsPlaying(false);
      setShowControls(true);
      saveProgress(movie.id, video.currentTime, video.duration || movie.durationSeconds || 0);
    };
    const onTimeUpdate = () => setCurrentTime(video.currentTime);
    const onDuration = () => setDuration(video.duration || movie.durationSeconds || 0);
    const onProgress = () => {
      const ranges = video.buffered;
      if (ranges.length > 0) setBufferedEnd(ranges.end(ranges.length - 1));
    };
    const onWaiting = () => setIsBuffering(true);
    const onPlaying = () => setIsBuffering(false);
    const onCanPlay = () => setIsBuffering(false);
    const onEnded = () => {
      setIsEnded(true);
      setIsPlaying(false);
      setShowControls(true);
      saveProgress(movie.id, video.duration, video.duration);
    };
    const onVolume = () => {
      setVolume(video.volume);
      setMuted(video.muted);
    };
    const onRate = () => setRate(video.playbackRate);
    const onPipEnter = () => setIsPip(true);
    const onPipLeave = () => setIsPip(false);

    video.addEventListener('loadedmetadata', applyResume);
    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('timeupdate', onTimeUpdate);
    video.addEventListener('durationchange', onDuration);
    video.addEventListener('progress', onProgress);
    video.addEventListener('waiting', onWaiting);
    video.addEventListener('playing', onPlaying);
    video.addEventListener('canplay', onCanPlay);
    video.addEventListener('ended', onEnded);
    video.addEventListener('volumechange', onVolume);
    video.addEventListener('ratechange', onRate);
    video.addEventListener('enterpictureinpicture', onPipEnter);
    video.addEventListener('leavepictureinpicture', onPipLeave);

    return () => {
      video.removeEventListener('loadedmetadata', applyResume);
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('timeupdate', onTimeUpdate);
      video.removeEventListener('durationchange', onDuration);
      video.removeEventListener('progress', onProgress);
      video.removeEventListener('waiting', onWaiting);
      video.removeEventListener('playing', onPlaying);
      video.removeEventListener('canplay', onCanPlay);
      video.removeEventListener('ended', onEnded);
      video.removeEventListener('volumechange', onVolume);
      video.removeEventListener('ratechange', onRate);
      video.removeEventListener('enterpictureinpicture', onPipEnter);
      video.removeEventListener('leavepictureinpicture', onPipLeave);
    };
  }, [movie.id, movie.durationSeconds, poke]);

  // ─── Persist progress on an interval + on unmount ──────────────────────────
  useEffect(() => {
    const interval = window.setInterval(() => {
      const video = videoRef.current;
      if (!video || video.paused) return;
      saveProgress(movie.id, video.currentTime, video.duration || movie.durationSeconds || 0);
    }, 5000);
    return () => window.clearInterval(interval);
  }, [movie.id, movie.durationSeconds]);

  useEffect(() => {
    return () => {
      const video = videoRef.current;
      if (video && !video.paused) {
        saveProgress(movie.id, video.currentTime, video.duration || 0);
      }
      if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
    };
  }, [movie.id]);

  // ─── Fullscreen tracking ───────────────────────────────────────────────────
  useEffect(() => {
    const onChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  // ─── Initial controls visibility ───────────────────────────────────────────
  useEffect(() => {
    poke();
  }, [poke]);

  // ─── Subtitle track mode sync ──────────────────────────────────────────────
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const tracks = video.textTracks;
    for (let i = 0; i < tracks.length; i++) {
      const track = tracks[i]!;
      if (!track.id.startsWith('cinesub-')) continue;
      const index = Number(track.id.slice('cinesub-'.length));
      track.mode = index === subIndex ? 'showing' : 'disabled';
    }
  }, [subIndex, subs]);

  // ─── Controls ──────────────────────────────────────────────────────────────

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.ended) {
      video.currentTime = 0;
      void video.play().catch(() => {});
      return;
    }
    if (video.paused) void video.play().catch(() => {});
    else video.pause();
  }, []);

  const seekTo = useCallback((time: number) => {
    const video = videoRef.current;
    if (!video) return;
    const max = video.duration || duration;
    video.currentTime = Math.min(Math.max(0, time), max > 0 ? max : 0);
    setCurrentTime(video.currentTime);
  }, [duration]);

  const seekBy = useCallback(
    (delta: number) => {
      const video = videoRef.current;
      if (!video) return;
      seekTo(video.currentTime + delta);
      setSeekFeedback({
        type: delta > 0 ? 'forward' : 'rewind',
        id: Date.now(),
      });
      poke();
    },
    [seekTo, poke],
  );

  const handleVolume = useCallback((value: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.volume = Math.min(1, Math.max(0, value));
    video.muted = value === 0;
  }, []);

  const toggleMute = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
  }, []);

  const toggleFullscreen = useCallback(() => {
    const shell = shellRef.current;
    if (!shell) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {});
    } else {
      void shell.requestFullscreen().catch(() => {});
    }
  }, []);

  const togglePip = useCallback(async () => {
    const video = videoRef.current;
    if (!video || !document.pictureInPictureEnabled) return;
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await video.requestPictureInPicture();
    } catch {
      /* PiP can be rejected by the browser. */
    }
  }, []);

  const changeRate = useCallback((value: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.playbackRate = value;
    setRate(value);
  }, []);

  const changeLevel = useCallback((value: number) => {
    setLevelIndex(value);
    if (hlsRef.current) hlsRef.current.currentLevel = value;
  }, []);

  const changeSubtitle = useCallback((value: number) => {
    setSubIndex(value);
  }, []);

  const changeAudioTrack = useCallback((value: number) => {
    setAudioTrackIndex(value);
    if (hlsRef.current) hlsRef.current.audioTrack = value;
  }, []);

  const handleClose = useCallback(() => {
    const video = videoRef.current;
    if (video) saveProgress(movie.id, video.currentTime, video.duration || 0);
    onClose();
  }, [movie.id, onClose]);

  // ─── Keyboard shortcuts ────────────────────────────────────────────────────
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;

      switch (e.key) {
        case ' ':
        case 'k':
        case 'K':
          e.preventDefault();
          togglePlay();
          poke();
          break;
        case 'ArrowRight':
          e.preventDefault();
          seekBy(10);
          break;
        case 'ArrowLeft':
          e.preventDefault();
          seekBy(-10);
          break;
        case 'l':
        case 'L':
          seekBy(10);
          break;
        case 'j':
        case 'J':
          seekBy(-10);
          break;
        case 'ArrowUp':
          e.preventDefault();
          handleVolume((videoRef.current?.volume ?? 1) + 0.1);
          poke();
          break;
        case 'ArrowDown':
          e.preventDefault();
          handleVolume((videoRef.current?.volume ?? 1) - 0.1);
          poke();
          break;
        case 'm':
        case 'M':
          toggleMute();
          poke();
          break;
        case 'f':
        case 'F':
          toggleFullscreen();
          break;
        case 'Escape':
          if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
          else handleClose();
          break;
        default:
          if (/^[0-9]$/.test(e.key)) {
            const ratio = Number(e.key) / 10;
            const total = videoRef.current?.duration ?? duration;
            if (total > 0) seekTo(total * ratio);
          }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [togglePlay, seekBy, poke, handleVolume, toggleMute, toggleFullscreen, handleClose, seekTo, duration]);

  // ─── Surface click (single = play/pause, double = fullscreen) ──────────────
  const handleSurfaceClick = useCallback(() => {
    if (clickTimerRef.current) return;
    clickTimerRef.current = window.setTimeout(() => {
      clickTimerRef.current = null;
      togglePlay();
    }, 220);
  }, [togglePlay]);

  const handleSurfaceDoubleClick = useCallback(() => {
    if (clickTimerRef.current) {
      window.clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }
    toggleFullscreen();
  }, [toggleFullscreen]);

  const controlsVisible = showControls || !isPlaying || menu !== 'none';

  const qualityLabel = useMemo(() => {
    if (levelIndex === -1) {
      const auto = levels[activeLevel];
      return auto ? `Auto (${auto.name})` : 'Auto';
    }
    return levels[levelIndex]?.name ?? 'Auto';
  }, [levelIndex, levels, activeLevel]);

  const VolumeIcon = muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;

  return (
    <div
      ref={shellRef}
      className={`player-shell ${controlsVisible ? 'controls-visible' : 'controls-hidden'} ${
        isFullscreen ? 'is-fullscreen' : ''
      }`}
      onMouseMove={poke}
      onTouchStart={poke}
      onClick={handleSurfaceClick}
      onDoubleClick={handleSurfaceDoubleClick}
    >
      <video
        ref={videoRef}
        className="player-video"
        playsInline
      >
        {subs.map((track, index) => (
          <track
            key={track.url}
            id={`cinesub-${index}`}
            kind="subtitles"
            src={track.url}
            srcLang={track.language}
            label={track.label}
          />
        ))}
      </video>

      {/* Buffering spinner */}
      {isBuffering && !isEnded && !error && (
        <div className="player-center">
          <Loader2 size={54} className="spin player-spinner" />
        </div>
      )}

      {/* Center play button when paused */}
      {!isPlaying && !isBuffering && !isEnded && !error && (
        <button
          className="player-bigplay"
          onClick={(e) => {
            e.stopPropagation();
            togglePlay();
          }}
          type="button"
          aria-label="Play"
        >
          <Play size={44} fill="currentColor" />
        </button>
      )}

      {/* Resume toast */}
      {resumeNotice && <div className="player-toast">{resumeNotice}</div>}

      {/* Seek feedback animation */}
      {seekFeedback && (
        <div
          key={seekFeedback.id}
          className={`player-seek-feedback ${
            seekFeedback.type === 'forward' ? 'is-forward' : 'is-rewind'
          }`}
        >
          {seekFeedback.type === 'forward' ? <SkipForward size={32} /> : <SkipBack size={32} />}
          <span>{seekFeedback.type === 'forward' ? '+10s' : '-10s'}</span>
        </div>
      )}

      {/* Error overlay */}
      {error && (
        <div className="player-error" onClick={(e) => e.stopPropagation()}>
          <p>{error}</p>
          <div className="player-error-actions">
            <button type="button" onClick={handleClose}>
              Back
            </button>
          </div>
        </div>
      )}

      {/* Ended overlay */}
      {isEnded && (
        <div className="player-ended" onClick={(e) => e.stopPropagation()}>
          <h2>{cleanTitle(movie.title)}</h2>
          <p>You&apos;ve finished this movie.</p>
          <div className="player-ended-actions">
            <button type="button" className="btn-primary" onClick={() => seekTo(0)}>
              <RotateCcw size={18} /> Watch again
            </button>
            <button type="button" className="btn-ghost" onClick={handleClose}>
              Back to browse
            </button>
          </div>
        </div>
      )}

      {/* Top bar */}
      <div className="player-topbar" onClick={(e) => e.stopPropagation()}>
        <button className="player-back" type="button" onClick={handleClose}>
          <ArrowLeft size={22} />
          <span>Back</span>
        </button>

        <div className="player-title">
          <h1>{cleanTitle(movie.title)}</h1>
          <div className="player-title-meta">
            {movie.height ? <span className="player-chip">HD {movie.height}p</span> : null}
            {movie.status === 'partial' ? (
              <span className="player-chip player-chip-accent">
                Transcoding {movie.transcodingProfile ?? ''}
              </span>
            ) : null}
            {subs.length > 0 && subIndex >= 0 ? (
              <span className="player-chip">{subs[subIndex]?.label}</span>
            ) : null}
          </div>
        </div>
      </div>

      {/* Bottom controls */}
      <div
        className="player-controls"
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
      >
        <SeekBar
          currentTime={currentTime}
          duration={duration}
          bufferedEnd={bufferedEnd}
          onScrub={seekTo}
          onCommit={poke}
        />

        <div className="controls-row">
          <button
            className="control-btn control-btn-lg"
            type="button"
            onClick={togglePlay}
            aria-label={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? <Pause size={26} fill="currentColor" /> : <Play size={26} fill="currentColor" />}
          </button>

          <button
            className="control-btn"
            type="button"
            onClick={() => seekBy(-10)}
            aria-label="Rewind 10 seconds"
          >
            <SkipBack size={22} />
          </button>

          <button
            className="control-btn"
            type="button"
            onClick={() => seekBy(10)}
            aria-label="Forward 10 seconds"
          >
            <SkipForward size={22} />
          </button>

          <div className="volume-control">
            <button
              className="control-btn"
              type="button"
              onClick={toggleMute}
              aria-label={muted ? 'Unmute' : 'Mute'}
            >
              <VolumeIcon size={22} />
            </button>
            <input
              className="volume-slider"
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={muted ? 0 : volume}
              onChange={(e) => handleVolume(Number(e.target.value))}
              aria-label="Volume"
            />
          </div>

          <button
            className="time-display"
            type="button"
            onClick={() => setShowRemaining((v) => !v)}
            title="Toggle remaining time"
          >
            {showRemaining
              ? `-${formatClock(Math.max(0, duration - currentTime))}`
              : formatClock(currentTime)}{' '}
            <span className="time-total">/ {formatClock(duration)}</span>
          </button>

          <div className="controls-spacer" />

          <span className="quality-pill">{qualityLabel}</span>

          <button
            className="control-btn"
            type="button"
            onClick={() => (menu === 'none' ? openMenu('root') : closeMenu())}
            aria-label="Settings"
          >
            <Settings size={22} />
          </button>

          {document.pictureInPictureEnabled ? (
            <button
              className={`control-btn ${isPip ? 'is-active' : ''}`}
              type="button"
              onClick={togglePip}
              aria-label="Picture in picture"
            >
              <PictureInPicture2 size={22} />
            </button>
          ) : null}

          <button
            className="control-btn"
            type="button"
            onClick={toggleFullscreen}
            aria-label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          >
            {isFullscreen ? <Minimize size={22} /> : <Maximize size={22} />}
          </button>
        </div>
      </div>

      {/* Settings panel */}
      {menu !== 'none' && (
        <div className="settings-panel" onClick={(e) => e.stopPropagation()}>
          {menu !== 'root' && (
            <button className="settings-header" type="button" onClick={() => setMenu('root')}>
              <ArrowLeft size={16} /> Back
            </button>
          )}

          {menu === 'root' && (
            <>
              <div className="settings-title">Settings</div>
              <MenuRow
                label="Playback speed"
                value={speedLabel(rate)}
                onClick={() => setMenu('speed')}
              />
              <MenuRow label="Quality" value={qualityLabel} onClick={() => setMenu('quality')} />
              {audioTracks.length > 1 && (
                <MenuRow
                  label="Audio"
                  value={audioTracks.find((t) => t.id === audioTrackIndex)?.name ?? 'Default'}
                  onClick={() => setMenu('audio')}
                />
              )}
              {subs.length > 0 && (
                <MenuRow
                  label="Subtitles"
                  value={subIndex >= 0 ? subs[subIndex]?.label ?? 'Off' : 'Off'}
                  onClick={() => setMenu('subs')}
                />
              )}
            </>
          )}

          {menu === 'speed' && (
            <>
              <div className="settings-title">Playback speed</div>
              {SPEED_OPTIONS.map((option) => (
                <MenuRow
                  key={option}
                  label={speedLabel(option)}
                  active={rate === option}
                  onClick={() => changeRate(option)}
                />
              ))}
            </>
          )}

          {menu === 'quality' && (
            <>
              <div className="settings-title">Quality</div>
              <MenuRow
                label="Auto"
                value={levels[activeLevel] ? `${levels[activeLevel]!.name} playing` : undefined}
                active={levelIndex === -1}
                onClick={() => changeLevel(-1)}
              />
              {levels.map((level) => (
                <MenuRow
                  key={level.id}
                  label={level.name}
                  active={levelIndex === level.id}
                  onClick={() => changeLevel(level.id)}
                />
              ))}
            </>
          )}

          {menu === 'subs' && (
            <>
              <div className="settings-title">
                <Subtitles size={16} /> Subtitles
              </div>
              <MenuRow label="Off" active={subIndex === -1} onClick={() => changeSubtitle(-1)} />
              {subs.map((track, index) => (
                <MenuRow
                  key={track.url}
                  label={track.label}
                  active={subIndex === index}
                  onClick={() => changeSubtitle(index)}
                />
              ))}
            </>
          )}

          {menu === 'audio' && (
            <>
              <div className="settings-title">Audio Track</div>
              {audioTracks.map((track) => (
                <MenuRow
                  key={track.id}
                  label={track.name}
                  active={audioTrackIndex === track.id}
                  onClick={() => changeAudioTrack(track.id)}
                />
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
};