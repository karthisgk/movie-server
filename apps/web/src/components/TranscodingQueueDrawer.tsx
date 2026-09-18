import React from 'react';
import { X, Cpu, Clock, CheckCircle2, Layers, AlertCircle } from 'lucide-react';
import { PublicMovie } from '../types';

interface TranscodingQueueDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  movies: PublicMovie[];
}

export const TranscodingQueueDrawer: React.FC<TranscodingQueueDrawerProps> = ({
  isOpen,
  onClose,
  movies,
}) => {
  if (!isOpen) return null;

  const activeMovie = movies.find(
    (m) => m.status === 'processing' || (m.status === 'partial' && (m.transcodingProgress ?? 0) < 100)
  );

  const queuedMovies = movies.filter((m) => m.status === 'queued');
  const completedMovies = movies.filter(
    (m) => m.status === 'ready' || (m.status === 'partial' && (m.transcodingProgress ?? 0) === 100)
  );

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      zIndex: 100,
      background: 'rgba(0, 0, 0, 0.75)',
      backdropFilter: 'blur(8px)',
      display: 'flex',
      justifyContent: 'flex-end',
    }}>
      <div className="glass-panel" style={{
        width: '100%',
        maxWidth: '480px',
        height: '100%',
        borderRadius: '16px 0 0 16px',
        display: 'flex',
        flexDirection: 'column',
        padding: '24px',
        boxShadow: '-10px 0 40px rgba(0,0,0,0.8)',
        borderLeft: '1px solid var(--border-glass)',
        overflowY: 'auto',
      }}>

        {/* Drawer Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px', paddingBottom: '16px', borderBottom: '1px solid var(--border-glass)' }}>
          <div>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Layers size={20} color="var(--accent-cyan)" />
              Transcoding Engine
            </h2>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
              Multi-Thread Worker Execution & Queue
            </p>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid var(--border-glass)',
              borderRadius: '50%',
              width: 36,
              height: 36,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
            }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Section 1: Active Transcode Task */}
        <div style={{ marginBottom: '28px' }}>
          <div style={{ fontSize: '0.8rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--accent-cyan)', letterSpacing: '0.05em', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Cpu size={14} className="spin" />
            Now Processing (Worker Threads)
          </div>

          {activeMovie ? (
            <div className="glass-card" style={{ padding: '16px', border: '1px solid rgba(0, 242, 254, 0.3)', background: 'rgba(0, 242, 254, 0.04)' }}>
              <h3 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '4px' }}>
                {activeMovie.title}
              </h3>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {activeMovie.filename}
              </p>

              {/* Progress & Workers breakdown */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: 500 }}>
                  Combined Multi-Thread Progress:
                </span>
                <span style={{ fontSize: '1rem', fontWeight: 800, color: 'var(--accent-cyan)' }}>
                  {activeMovie.transcodingProgress ?? 0}%
                </span>
              </div>

              {/* Shimmer progress bar */}
              <div style={{ width: '100%', height: 8, background: 'rgba(255,255,255,0.08)', borderRadius: 4, overflow: 'hidden', marginBottom: '12px' }}>
                <div
                  className="progress-active-bar"
                  style={{
                    width: `${activeMovie.transcodingProgress ?? 0}%`,
                    height: '100%',
                    borderRadius: 4,
                  }}
                />
              </div>

              {/* Active workers badge list */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                <span>Active Workers:</span>
                <span style={{ background: 'rgba(0, 242, 254, 0.15)', color: 'var(--accent-cyan)', padding: '2px 8px', borderRadius: 4, fontWeight: 700 }}>
                  {activeMovie.transcodingProfile || '720p + 1080p'}
                </span>
              </div>
            </div>
          ) : (
            <div style={{ padding: '20px', textAlign: 'center', background: 'rgba(255,255,255,0.02)', borderRadius: 'var(--radius-md)', border: '1px dashed var(--border-glass)', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
              No active transcoding job. All queued movies processed!
            </div>
          )}
        </div>

        {/* Section 2: Transcoding Queue */}
        <div style={{ marginBottom: '28px' }}>
          <div style={{ fontSize: '0.8rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--accent-amber)', letterSpacing: '0.05em', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Clock size={14} />
            Transcoding Queue ({queuedMovies.length})
          </div>

          {queuedMovies.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {queuedMovies.map((movie, idx) => (
                <div key={movie.id} className="glass-card" style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <div style={{ background: 'rgba(255, 159, 10, 0.15)', color: 'var(--accent-amber)', fontWeight: 800, width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.8rem' }}>
                      #{idx + 1}
                    </div>
                    <div>
                      <h4 style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                        {movie.title}
                      </h4>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                        {(movie.sizeBytes / (1024 * 1024 * 1024)).toFixed(1)} GB • Waiting for workers
                      </span>
                    </div>
                  </div>
                  <span className="badge badge-queued" style={{ fontSize: '0.7rem' }}>
                    Queued
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ padding: '16px', textAlign: 'center', background: 'rgba(255,255,255,0.02)', borderRadius: 'var(--radius-md)', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
              Queue is empty. No pending movies waiting for transcoding.
            </div>
          )}
        </div>

        {/* Section 3: Completed / Ready */}
        <div>
          <div style={{ fontSize: '0.8rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--accent-emerald)', letterSpacing: '0.05em', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <CheckCircle2 size={14} />
            Completed & Playable ({completedMovies.length})
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {completedMovies.map((movie) => (
              <div key={movie.id} style={{ padding: '10px 14px', background: 'rgba(255,255,255,0.03)', borderRadius: 'var(--radius-sm)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 500 }}>
                  {movie.title}
                </span>
                <span style={{ fontSize: '0.75rem', color: 'var(--accent-emerald)', fontWeight: 600 }}>
                  {(movie.completedProfiles ?? []).join(', ') || 'Ready'}
                </span>
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
};
