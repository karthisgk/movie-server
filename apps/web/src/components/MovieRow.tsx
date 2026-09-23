import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { PublicMovie, WatchProgress } from '../types';
import { MovieCard } from './MovieCard';

interface MovieRowProps {
  title: string;
  movies: PublicMovie[];
  progress: Record<string, WatchProgress>;
  queueOrder: string[];
  onPlay: (movie: PublicMovie) => void;
  onInfo: (movie: PublicMovie) => void;
}

export const MovieRow: React.FC<MovieRowProps> = ({
  title,
  movies,
  progress,
  queueOrder,
  onPlay,
  onInfo,
}) => {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const updateArrows = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 8);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 8);
  }, []);

  useEffect(() => {
    updateArrows();
    const el = scrollerRef.current;
    if (!el) return;
    el.addEventListener('scroll', updateArrows, { passive: true });
    window.addEventListener('resize', updateArrows);
    return () => {
      el.removeEventListener('scroll', updateArrows);
      window.removeEventListener('resize', updateArrows);
    };
  }, [updateArrows, movies.length]);

  const scrollByPage = (direction: 1 | -1) => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollBy({ left: direction * el.clientWidth * 0.9, behavior: 'smooth' });
  };

  if (movies.length === 0) return null;

  return (
    <section className="movie-row">
      <h2 className="row-title">{title}</h2>

      <div className="row-viewport">
        {canScrollLeft && (
          <button
            type="button"
            className="row-arrow row-arrow-left"
            onClick={() => scrollByPage(-1)}
            aria-label="Scroll left"
          >
            <ChevronLeft size={26} />
          </button>
        )}

        <div className="row-scroller" ref={scrollerRef}>
          {movies.map((movie) => {
            const queueIndex = queueOrder.indexOf(movie.id);
            return (
              <MovieCard
                key={movie.id}
                movie={movie}
                progress={progress[movie.id]}
                queuePosition={queueIndex >= 0 ? queueIndex + 1 : undefined}
                onPlay={onPlay}
                onInfo={onInfo}
              />
            );
          })}
        </div>

        {canScrollRight && (
          <button
            type="button"
            className="row-arrow row-arrow-right"
            onClick={() => scrollByPage(1)}
            aria-label="Scroll right"
          >
            <ChevronRight size={26} />
          </button>
        )}
      </div>
    </section>
  );
};