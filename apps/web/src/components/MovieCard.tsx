import React from 'react';
import { Play, Clock, AlertTriangle, CheckCircle2, Cpu, Film } from 'lucide-react';
import { PublicMovie } from '../types';

interface MovieCardProps {
  movie: PublicMovie;
  queuePosition?: number;
  onPlay: (movie: PublicMovie) => void;
}

export const MovieCard: React.FC<MovieCardProps> = ({ movie, queuePosition, onPlay }) => {
  const formatDuration = (seconds?: number) => {
    if (!seconds) return 'Duration unknown';
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    return hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`;
  };

  const formatSize = (bytes: number) => {
    const gb = bytes / (1024 * 1024 * 1024);
    return `${gb.toFixed(1)} GB`;
  };

  const isPlayable = movie.status === 'ready' || movie.status === 'partial';
  const isTranscoding = movie.status === 'processing' || (movie.status === 'partial' && (movie.transcodingProgress ?? 0) < 100);

  return (
    <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', height: '100%', position: 'relative' }}>
      
      {/* Poster Art / Abstract Banner */}
      <div style={{
        height: '180px',
        background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.8), rgba(15, 23, 42, 0.95))',
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderBottom: '1px solid var(--border-glass)'
      }}>
        {/* Abstract pattern / icon */}
        <Film size={48} color="rgba(255, 255, 255, 0.08)" />

        {/* Top Badges */}
        <div style={{ position: 'absolute', top: 12, left: 12, right: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          
          {/* Status Badge */}
          {movie.status === 'ready' && (
            <span className="badge badge-ready">
              <CheckCircle2 size={12} /> Ready
            </span>
          )}

          {movie.status === 'partial' && (
            <span className="badge badge-partial">
              <Play size={12} /> Playable (Partial)
            </span>
          )}

          {movie.status === 'processing' && (
            <span className="badge badge-processing">
              <Cpu size={12} className="spin" /> Transcoding
            </span>
          )}

          {movie.status === 'queued' && (
            <span className="badge badge-queued">
              <Clock size={12} /> {queuePosition ? `Queue #${queuePosition}` : 'Queued'}
            </span>
          )}

          {movie.status === 'failed' && (
            <span className="badge badge-failed">
              <AlertTriangle size={12} /> Transcode Failed
            </span>
          )}

          {/* Quality profiles badge */}
          <div style={{ display: 'flex', gap: 4 }}>
            {(movie.completedProfiles ?? []).map((p) => (
              <span key={p} style={{ fontSize: '0.65rem', padding: '2px 6px', borderRadius: 4, background: 'rgba(0, 242, 254, 0.15)', color: 'var(--accent-cyan)', fontWeight: 700 }}>
                {p}
              </span>
            ))}
          </div>

        </div>

        {/* Overlay Play Button if Playable */}
        {isPlayable && (
          <button
            onClick={() => onPlay(movie)}
            style={{
              position: 'absolute',
              width: 56,
              height: 56,
              borderRadius: '50%',
              background: 'linear-gradient(135deg, #00f2fe 0%, #4facfe 100%)',
              border: 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 0 25px rgba(0, 242, 254, 0.5)',
              transition: 'transform 0.2s ease',
            }}
          >
            <Play size={24} color="#0a0d14" style={{ marginLeft: 4 }} />
          </button>
        )}
      </div>

      {/* Card Content */}
      <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', flex: 1, justifyContent: 'space-between' }}>
        <div>
          <h3 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '6px', color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={movie.title}>
            {movie.title}
          </h3>

          <div style={{ display: 'flex', gap: '12px', fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '12px' }}>
            <span>{formatDuration(movie.durationSeconds)}</span>
            <span>•</span>
            <span>{formatSize(movie.sizeBytes)}</span>
            {movie.height && (
              <>
                <span>•</span>
                <span>{movie.height}p Source</span>
              </>
            )}
          </div>
        </div>

        {/* Active Transcoding Progress Bar (Multi-thread worker progress out of 100%) */}
        {isTranscoding && (
          <div style={{ marginTop: 'auto', paddingTop: '10px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', marginBottom: '6px' }}>
              <span style={{ color: 'var(--accent-cyan)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
                <Cpu size={12} className="spin" /> Workers: {movie.transcodingProfile || 'Multi-thread'}
              </span>
              <span style={{ color: 'var(--text-primary)', fontWeight: 700 }}>
                {movie.transcodingProgress ?? 0}%
              </span>
            </div>

            <div style={{ width: '100%', height: 6, background: 'rgba(255,255,255,0.08)', borderRadius: 3, overflow: 'hidden' }}>
              <div
                className="progress-active-bar"
                style={{
                  width: `${movie.transcodingProgress ?? 0}%`,
                  height: '100%',
                  borderRadius: 3,
                  transition: 'width 0.3s ease',
                }}
              />
            </div>
          </div>
        )}

        {/* Action Button */}
        {isPlayable && (
          <button
            onClick={() => onPlay(movie)}
            style={{
              marginTop: '14px',
              width: '100%',
              padding: '10px',
              background: 'rgba(255, 255, 255, 0.08)',
              border: '1px solid var(--border-glass)',
              borderRadius: 'var(--radius-md)',
              color: 'var(--text-primary)',
              fontWeight: 600,
              fontSize: '0.85rem',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              transition: 'all 0.2s ease',
            }}
          >
            <Play size={16} color="var(--accent-cyan)" />
            <span>{movie.status === 'partial' ? 'Stream Partial' : 'Watch Movie'}</span>
          </button>
        )}

      </div>
    </div>
  );
};
