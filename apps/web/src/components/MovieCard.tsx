import React from 'react';
import { Info, Play, RotateCcw } from 'lucide-react';
import { PublicMovie, WatchProgress } from '../types';
import {
  cleanTitle,
  extractYear,
  formatClock,
  metaLine,
  posterGradient,
  progressRatio,
} from '../lib/format';

interface MovieCardProps {
  movie: PublicMovie;
  progress?: WatchProgress;
  queuePosition?: number;
  onPlay: (movie: PublicMovie) => void;
  onInfo: (movie: PublicMovie) => void;
}

export const MovieCard: React.FC<MovieCardProps> = ({
  movie,
  progress,
  queuePosition,
  onPlay,
  onInfo,
}) => {
  const playable = movie.status === 'ready' || movie.status === 'partial';
  const year = extractYear(movie.title);
  const ratio = progress ? progressRatio(progress.time, progress.duration) : 0;
  const hasProgress = playable && ratio > 0 && ratio < 1;

  const statusLabel = (() => {
    switch (movie.status) {
      case 'ready':
        return { text: 'Ready', className: 'tag-ready' };
      case 'partial':
        return { text: `Transcoding ${movie.transcodingProgress ?? 0}%`, className: 'tag-processing' };
      case 'processing':
        return { text: movie.transcodingProgress ? `${movie.transcodingProgress}%` : 'Processing', className: 'tag-processing' };
      case 'queued':
        return { text: queuePosition ? `Queue #${queuePosition}` : 'Queued', className: 'tag-queued' };
      case 'failed':
        return { text: 'Failed', className: 'tag-failed' };
      default:
        return { text: 'Discovered', className: 'tag-neutral' };
    }
  })();

  return (
    <div className="movie-card">
      <button
        type="button"
        className="movie-card-poster"
        style={{ background: posterGradient(movie.id) }}
        onClick={() => (playable ? onPlay(movie) : onInfo(movie))}
        aria-label={`${cleanTitle(movie.title)}`}
      >
        <span className="movie-card-initial">{cleanTitle(movie.title).charAt(0)}</span>

        <span className={`movie-tag ${statusLabel.className}`}>{statusLabel.text}</span>

        {movie.completedProfiles && movie.completedProfiles.length > 0 && (
          <span className="movie-card-profiles">
            {movie.completedProfiles.map((profile) => (
              <span key={profile}>{profile}</span>
            ))}
          </span>
        )}

        <span className="movie-card-hover">
          <span className="movie-card-title">{cleanTitle(movie.title)}</span>
          <span className="movie-card-meta">{metaLine(movie)}</span>
          <span className="movie-card-actions">
            <span className="movie-card-play">
              {hasProgress ? <RotateCcw size={16} /> : <Play size={16} fill="currentColor" />}
              {hasProgress ? 'Resume' : playable ? 'Play' : 'Details'}
            </span>
            <span
              role="button"
              tabIndex={0}
              className="movie-card-info"
              onClick={(e) => {
                e.stopPropagation();
                onInfo(movie);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.stopPropagation();
                  onInfo(movie);
                }
              }}
            >
              <Info size={16} />
            </span>
          </span>
        </span>

        {hasProgress && (
          <span className="movie-card-progress">
            <span style={{ width: `${ratio * 100}%` }} />
          </span>
        )}
      </button>

      <div className="movie-card-foot">
        <div className="movie-card-foot-title">{cleanTitle(movie.title)}</div>
        <div className="movie-card-foot-meta">
          {year ? <span>{year}</span> : null}
          <span>{movie.height ? `${movie.height}p` : 'HD'}</span>
          {hasProgress && progress ? (
            <span className="movie-card-remaining">{formatClock(progress.duration - progress.time)} left</span>
          ) : null}
        </div>
      </div>
    </div>
  );
};