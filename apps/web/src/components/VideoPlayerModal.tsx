import React, { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import { X, Play, Pause, Volume2, VolumeX, Maximize, Settings, Subtitles, Film } from 'lucide-react';
import { PublicMovie } from '../types';

interface VideoPlayerModalProps {
  movie: PublicMovie | null;
  onClose: () => void;
}

export const VideoPlayerModal: React.FC<VideoPlayerModalProps> = ({ movie, onClose }) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [levels, setLevels] = useState<{ id: number; name: string }[]>([]);
  const [currentLevel, setCurrentLevel] = useState<number>(-1); // -1 = Auto
  const [subtitles, setSubtitles] = useState<{ id: number; name: string }[]>([]);
  const [currentSubtitle, setCurrentSubtitle] = useState<number>(-1); // -1 = Off

  useEffect(() => {
    if (!movie || !videoRef.current) return;

    const video = videoRef.current;
    const playUrl = movie.playUrl;

    if (Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
      });

      hlsRef.current = hls;
      hls.loadSource(playUrl);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, (_event, data) => {
        const availableLevels = data.levels.map((lvl, index) => ({
          id: index,
          name: lvl.height ? `${lvl.height}p` : `Level ${index + 1}`,
        }));
        setLevels(availableLevels);

        video.play().catch(() => {});
        setIsPlaying(true);
      });

      hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, (_event, data) => {
        const availableSubs = data.subtitleTracks.map((sub, index) => ({
          id: index,
          name: sub.name || sub.lang || `Track ${index + 1}`,
        }));
        setSubtitles(availableSubs);
      });

      return () => {
        hls.destroy();
        hlsRef.current = null;
      };
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      // Native Safari HLS support
      video.src = playUrl;
      video.play().catch(() => {});
      setIsPlaying(true);
    }
  }, [movie]);

  if (!movie) return null;

  const handleLevelChange = (levelId: number) => {
    if (hlsRef.current) {
      hlsRef.current.currentLevel = levelId;
      setCurrentLevel(levelId);
    }
  };

  const handleSubtitleChange = (subId: number) => {
    if (hlsRef.current) {
      hlsRef.current.subtitleTrack = subId;
      setCurrentSubtitle(subId);
    }
  };

  const togglePlay = () => {
    if (!videoRef.current) return;
    if (videoRef.current.paused) {
      videoRef.current.play();
      setIsPlaying(true);
    } else {
      videoRef.current.pause();
      setIsPlaying(false);
    }
  };

  const toggleMute = () => {
    if (!videoRef.current) return;
    videoRef.current.muted = !videoRef.current.muted;
    setIsMuted(videoRef.current.muted);
  };

  const toggleFullscreen = () => {
    if (!videoRef.current) return;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      videoRef.current.requestFullscreen().catch(() => {});
    }
  };

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      zIndex: 200,
      background: 'rgba(0, 0, 0, 0.95)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
    }}>
      {/* Top Header Bar */}
      <div style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        padding: '20px 32px',
        background: 'linear-gradient(180deg, rgba(0,0,0,0.8) 0%, transparent 100%)',
        zIndex: 10,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <Film size={24} color="var(--accent-cyan)" />
          <div>
            <h2 style={{ fontSize: '1.2rem', fontWeight: 700, color: '#fff' }}>
              {movie.title}
            </h2>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
              {movie.status === 'partial' ? 'Streaming Partial (Transcoding remaining resolutions)' : 'Streaming HLS'}
            </span>
          </div>
        </div>

        <button
          onClick={onClose}
          style={{
            background: 'rgba(255, 255, 255, 0.1)',
            border: 'none',
            borderRadius: '50%',
            width: 40,
            height: 40,
            color: '#fff',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <X size={24} />
        </button>
      </div>

      {/* Video Container */}
      <div style={{ width: '100%', maxHeight: '85vh', maxWidth: '1400px', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <video
          ref={videoRef}
          controls
          style={{ width: '100%', maxHeight: '80vh', borderRadius: '12px', boxShadow: '0 20px 60px rgba(0,0,0,0.9)' }}
        />
      </div>

      {/* Bottom Controls Bar for Resolution & Subtitles */}
      <div style={{
        margin: '16px 0 0 0',
        display: 'flex',
        alignItems: 'center',
        gap: '24px',
        padding: '12px 24px',
        background: 'rgba(20, 25, 35, 0.8)',
        backdropFilter: 'blur(12px)',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--border-glass)',
      }}>
        
        {/* Quality Selector */}
        {levels.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.85rem' }}>
            <Settings size={16} color="var(--accent-cyan)" />
            <span style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>Quality:</span>
            <select
              value={currentLevel}
              onChange={(e) => handleLevelChange(Number(e.target.value))}
              style={{
                background: 'rgba(255, 255, 255, 0.08)',
                color: '#fff',
                border: '1px solid var(--border-glass)',
                borderRadius: '6px',
                padding: '4px 8px',
                fontSize: '0.8rem',
                cursor: 'pointer',
                outline: 'none',
              }}
            >
              <option value={-1} style={{ background: '#121824' }}>Auto (Adaptive)</option>
              {levels.map((lvl) => (
                <option key={lvl.id} value={lvl.id} style={{ background: '#121824' }}>
                  {lvl.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Subtitles Selector */}
        {subtitles.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.85rem' }}>
            <Subtitles size={16} color="var(--accent-blue)" />
            <span style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>Subtitles:</span>
            <select
              value={currentSubtitle}
              onChange={(e) => handleSubtitleChange(Number(e.target.value))}
              style={{
                background: 'rgba(255, 255, 255, 0.08)',
                color: '#fff',
                border: '1px solid var(--border-glass)',
                borderRadius: '6px',
                padding: '4px 8px',
                fontSize: '0.8rem',
                cursor: 'pointer',
                outline: 'none',
              }}
            >
              <option value={-1} style={{ background: '#121824' }}>Off</option>
              {subtitles.map((sub) => (
                <option key={sub.id} value={sub.id} style={{ background: '#121824' }}>
                  {sub.name}
                </option>
              ))}
            </select>
          </div>
        )}

      </div>
    </div>
  );
};
