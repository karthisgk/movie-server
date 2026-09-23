import React from 'react';
import { Info, Play, RotateCcw } from 'lucide-react';
import { PublicMovie, WatchProgress } from '../types';
import {
  cleanTitle,
  extractYear,
  formatClock,
  posterGradient,
  progressRatio,
} from '../lib/format';

interface HeroBillboardProps {
  movie: PublicMovie;
  progress?: WatchProgress;
  onPlay: (movie: PublicMovie) => void;
  onInfo: (movie: PublicMovie) => void;
}

export const HeroBillboard: React.FC<HeroBillboardProps> = ({
  movie,
  progress,
  onPlay,
  onInfo,
}) => {
  const year = extractYear(movie.title);
  const ratio = progress ? progressRatio(progress.time, progress.duration) : 0;
  const hasProgress = ratio > 0 && ratio < 1;

  const maxQuality = movie.height
    ? movie.height >= 1080
      ? '1080p'
      : movie.height >= 720
        ? '720p'
        : '480p'
    : 'HD';

  return (
    <section className="hero" style={{ background: posterGradient(movie.id) }}>
      <div className="hero-vignette" />
      <div className="hero-content">
        <div className="hero-badge">
          <span className="hero-badge-dot" />
          Featured from your library
        </div>

        <h1 className="hero-title">{cleanTitle(movie.title)}</h1>

        <div className="hero-meta">
          {year ? <span>{year}</span> : null}
          <span className="hero-meta-pill">{maxQuality}</span>
          {movie.videoCodec ? <span>{movie.videoCodec.toUpperCase()}</span> : null}
          {movie.audioCodec ? <span>{movie.audioCodec.toUpperCase()}</span> : null}
          <span>Adaptive HLS</span>
        </div>

        <p className="hero-synopsis">
          Streaming directly from your home library in up to {maxQuality} across{' '}
          {(movie.completedProfiles ?? []).length > 0
            ? movie.completedProfiles!.join(', ')
            : maxQuality}{' '}
          quality variants. Fully local, no internet required.
        </p>

        <div className="hero-actions">
          <button type="button" className="btn-primary" onClick={() => onPlay(movie)}>
            {hasProgress ? <RotateCcw size={20} /> : <Play size={20} fill="currentColor" />}
            {hasProgress ? `Resume from ${formatClock(progress!.time)}` : 'Play'}
          </button>

          <button type="button" className="btn-ghost" onClick={() => onInfo(movie)}>
            <Info size={20} />
            More Info
          </button>
        </div>

        {hasProgress && (
          <div className="hero-progress" aria-hidden>
            <span style={{ width: `${ratio * 100}%` }} />
          </div>
        )}
      </div>
    </section>
  );
};