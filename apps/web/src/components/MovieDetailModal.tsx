import React, { useEffect } from 'react';
import { AlertTriangle, CheckCircle2, Clock, Cpu, HardDrive, Film, Play, RotateCcw, X } from 'lucide-react';
import { PublicMovie, WatchProgress } from '../types';
import {
  cleanTitle,
  extractYear,
  formatClock,
  formatDuration,
  formatSize,
  posterGradient,
  progressRatio,
} from '../lib/format';

interface MovieDetailModalProps {
  movie: PublicMovie;
  progress?: WatchProgress;
  onClose: () => void;
  onPlay: (movie: PublicMovie) => void;
}

const STATUS_LABEL: Record<PublicMovie['status'], string> = {
  discovered: 'Discovered',
  queued: 'Queued for transcoding',
  processing: 'Transcoding',
  partial: 'Playable — transcoding remaining qualities',
  ready: 'Ready to stream',
  failed: 'Transcoding failed',
};

export const MovieDetailModal: React.FC<MovieDetailModalProps> = ({
  movie,
  progress,
  onClose,
  onPlay,
}) => {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  const playable = movie.status === 'ready' || movie.status === 'partial';
  const year = extractYear(movie.title);
  const ratio = progress ? progressRatio(progress.time, progress.duration) : 0;
  const hasProgress = playable && ratio > 0 && ratio < 1;

  return (
    <div className="detail-backdrop" onClick={onClose}>
      <div className="detail-modal" onClick={(e) => e.stopPropagation()}>
        <div className="detail-hero" style={{ background: posterGradient(movie.id) }}>
          <div className="detail-hero-vignette" />
          <button type="button" className="detail-close" onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>

          <div className="detail-hero-content">
            <h2>{cleanTitle(movie.title)}</h2>
            <div className="detail-hero-meta">
              {year ? <span>{year}</span> : null}
              <span>{formatDuration(movie.durationSeconds)}</span>
              {movie.height ? (
                <span className="hero-meta-pill">{movie.height}p</span>
              ) : null}
            </div>

            <div className="hero-actions">
              <button
                type="button"
                className="btn-primary"
                disabled={!playable}
                onClick={() => onPlay(movie)}
              >
                {hasProgress ? <RotateCcw size={18} /> : <Play size={18} fill="currentColor" />}
                {playable ? (hasProgress ? `Resume from ${formatClock(progress!.time)}` : 'Play') : 'Not ready'}
              </button>
            </div>

            {hasProgress && (
              <div className="hero-progress">
                <span style={{ width: `${ratio * 100}%` }} />
              </div>
            )}
          </div>
        </div>

        <div className="detail-body">
          <div className="detail-status">
            {movie.status === 'failed' ? (
              <span className="detail-status-line detail-status-error">
                <AlertTriangle size={16} /> {STATUS_LABEL[movie.status]}
              </span>
            ) : movie.status === 'ready' ? (
              <span className="detail-status-line detail-status-ok">
                <CheckCircle2 size={16} /> {STATUS_LABEL[movie.status]}
              </span>
            ) : movie.status === 'processing' ? (
              <span className="detail-status-line detail-status-processing">
                <Cpu size={16} className="spin" /> {STATUS_LABEL[movie.status]}{' '}
                {movie.transcodingProgress ? `— ${movie.transcodingProgress}%` : ''}
              </span>
            ) : (
              <span className="detail-status-line detail-status-queued">
                <Clock size={16} /> {STATUS_LABEL[movie.status]}
              </span>
            )}
          </div>

          {movie.error ? <p className="detail-error">{movie.error}</p> : null}

          <dl className="detail-grid">
            <div>
              <dt><Film size={14} /> File</dt>
              <dd title={movie.filename}>{movie.filename}</dd>
            </div>
            <div>
              <dt><HardDrive size={14} /> Size</dt>
              <dd>{formatSize(movie.sizeBytes)}</dd>
            </div>
            <div>
              <dt>Resolution</dt>
              <dd>{movie.width && movie.height ? `${movie.width}×${movie.height}` : 'Unknown'}</dd>
            </div>
            <div>
              <dt>Runtime</dt>
              <dd>{formatDuration(movie.durationSeconds)}</dd>
            </div>
            <div>
              <dt>Video codec</dt>
              <dd>{movie.videoCodec?.toUpperCase() ?? 'Unknown'}</dd>
            </div>
            <div>
              <dt>Audio codec</dt>
              <dd>{movie.audioCodec?.toUpperCase() ?? 'Unknown'}</dd>
            </div>
            <div>
              <dt>Quality variants</dt>
              <dd>{(movie.completedProfiles ?? []).join(', ') || 'None'}</dd>
            </div>
            <div>
              <dt>Source file</dt>
              <dd>{movie.sourceAvailable ? 'Present on disk' : 'Removed — serving HLS only'}</dd>
            </div>
          </dl>
        </div>
      </div>
    </div>
  );
};