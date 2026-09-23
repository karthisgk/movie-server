import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Play, Cpu } from 'lucide-react';
import { Navbar } from './components/Navbar';
import { HeroBillboard } from './components/HeroBillboard';
import { MovieRow } from './components/MovieRow';
import { MovieCard } from './components/MovieCard';
import { MovieDetailModal } from './components/MovieDetailModal';
import { TranscodingQueueDrawer } from './components/TranscodingQueueDrawer';
import { VideoPlayer } from './components/VideoPlayer';
import { PublicMovie } from './types';
import { useAllProgress } from './hooks/useAllProgress';
import { progressRatio } from './lib/format';

export const App: React.FC = () => {
  const [movies, setMovies] = useState<PublicMovie[]>([]);
  const [loading, setLoading] = useState(true);
  const [isQueueOpen, setIsQueueOpen] = useState(false);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);

  const progress = useAllProgress();

  const fetchMovies = useCallback(async () => {
    try {
      setIsRefreshing(true);
      const res = await fetch('/videos');
      if (res.ok) setMovies((await res.json()) as PublicMovie[]);
    } catch (err) {
      console.error('Failed to fetch movies:', err);
    } finally {
      setIsRefreshing(false);
      setLoading(false);
    }
  }, []);

  // Live library updates via Server-Sent Events.
  useEffect(() => {
    void fetchMovies();

    const eventSource = new EventSource('/videos/events');
    const apply = (raw: string) => {
      try {
        setMovies(JSON.parse(raw) as PublicMovie[]);
        setLoading(false);
      } catch (err) {
        console.error('Failed to parse movie event:', err);
      }
    };

    eventSource.addEventListener('init', (e) => apply((e as MessageEvent).data));
    eventSource.addEventListener('update', (e) => apply((e as MessageEvent).data));
    eventSource.onerror = () => {
      /* EventSource reconnects automatically. */
    };

    return () => eventSource.close();
  }, [fetchMovies]);

  const playable = useMemo(
    () => movies.filter((m) => m.status === 'ready' || m.status === 'partial'),
    [movies],
  );

  const queuedMovies = useMemo(() => movies.filter((m) => m.status === 'queued'), [movies]);
  const queueOrder = useMemo(() => queuedMovies.map((m) => m.id), [queuedMovies]);

  const continueWatching = useMemo(
    () =>
      playable
        .filter((m) => {
          const entry = progress[m.id];
          if (!entry) return false;
          const ratio = progressRatio(entry.time, entry.duration);
          return ratio > 0.02 && ratio < 0.98;
        })
        .sort((a, b) => (progress[b.id]?.updatedAt ?? 0) - (progress[a.id]?.updatedAt ?? 0)),
    [playable, progress],
  );

  const recentlyAdded = useMemo(
    () =>
      [...movies].sort(
        (a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0),
      ),
    [movies],
  );

  const inProgress = useMemo(
    () =>
      movies.filter(
        (m) => m.status === 'processing' || (m.status === 'partial' && (m.transcodingProgress ?? 0) < 100),
      ),
    [movies],
  );

  const failedMovies = useMemo(() => movies.filter((m) => m.status === 'failed'), [movies]);

  const activeTranscode = inProgress[0];

  const featured = useMemo(
    () => continueWatching[0] ?? playable[0] ?? movies[0] ?? null,
    [continueWatching, playable, movies],
  );

  const searchResults = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return null;
    return movies.filter(
      (m) =>
        m.title.toLowerCase().includes(query) || m.filename.toLowerCase().includes(query),
    );
  }, [movies, searchQuery]);

  const playerMovie = playerId ? movies.find((m) => m.id === playerId) ?? null : null;
  const detailMovie = detailId ? movies.find((m) => m.id === detailId) ?? null : null;

  useEffect(() => {
    if (playerId && !movies.some((m) => m.id === playerId)) setPlayerId(null);
  }, [movies, playerId]);

  const openPlayer = useCallback((movie: PublicMovie) => {
    setDetailId(null);
    setPlayerId(movie.id);
  }, []);

  const openDetail = useCallback((movie: PublicMovie) => setDetailId(movie.id), []);

  return (
    <div className="app-shell">
      <Navbar
        movies={movies}
        onOpenQueue={() => setIsQueueOpen(true)}
        onRefresh={fetchMovies}
        isRefreshing={isRefreshing}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
      />

      {loading && movies.length === 0 ? (
        <div className="app-loading">
          <Loader2 size={40} className="spin" />
          <p>Loading your library…</p>
        </div>
      ) : (
        <main className="app-main">
          {searchResults ? (
            <section className="search-results">
              <h2 className="row-title">
                {searchResults.length > 0
                  ? `Results for “${searchQuery.trim()}”`
                  : `No results for “${searchQuery.trim()}”`}
              </h2>
              {searchResults.length > 0 && (
                <div className="search-grid">
                  {searchResults.map((movie) => (
                    <MovieCard
                      key={movie.id}
                      movie={movie}
                      progress={progress[movie.id]}
                      queuePosition={queueOrder.indexOf(movie.id) >= 0 ? queueOrder.indexOf(movie.id) + 1 : undefined}
                      onPlay={openPlayer}
                      onInfo={openDetail}
                    />
                  ))}
                </div>
              )}
            </section>
          ) : movies.length === 0 ? (
            <div className="app-empty">
              <Play size={42} />
              <h2>Your library is empty</h2>
              <p>
                Drop movie files into the server&apos;s <code>MOVIE_DIRECTORY</code>. They will appear
                here automatically once discovered and transcoded.
              </p>
            </div>
          ) : (
            <>
              {featured && (
                <HeroBillboard
                  movie={featured}
                  progress={progress[featured.id]}
                  onPlay={openPlayer}
                  onInfo={openDetail}
                />
              )}

              {activeTranscode && (
                <button
                  type="button"
                  className="transcode-strip"
                  onClick={() => setIsQueueOpen(true)}
                >
                  <Cpu size={18} className="spin" />
                  <span className="transcode-strip-title">
                    Now transcoding <strong>{activeTranscode.title}</strong>
                  </span>
                  <span className="transcode-strip-bar">
                    <span style={{ width: `${activeTranscode.transcodingProgress ?? 0}%` }} />
                  </span>
                  <span className="transcode-strip-pct">
                    {activeTranscode.transcodingProgress ?? 0}%
                  </span>
                </button>
              )}

              <div id="library" className="rows">
                <MovieRow
                  title="Continue Watching"
                  movies={continueWatching}
                  progress={progress}
                  queueOrder={queueOrder}
                  onPlay={openPlayer}
                  onInfo={openDetail}
                />
                <MovieRow
                  title="Available Now"
                  movies={playable}
                  progress={progress}
                  queueOrder={queueOrder}
                  onPlay={openPlayer}
                  onInfo={openDetail}
                />
                <MovieRow
                  title="Recently Added"
                  movies={recentlyAdded}
                  progress={progress}
                  queueOrder={queueOrder}
                  onPlay={openPlayer}
                  onInfo={openDetail}
                />
                <MovieRow
                  title="Currently Processing"
                  movies={inProgress}
                  progress={progress}
                  queueOrder={queueOrder}
                  onPlay={openPlayer}
                  onInfo={openDetail}
                />
                <MovieRow
                  title="Queued"
                  movies={queuedMovies}
                  progress={progress}
                  queueOrder={queueOrder}
                  onPlay={openPlayer}
                  onInfo={openDetail}
                />
                <MovieRow
                  title="Needs Attention"
                  movies={failedMovies}
                  progress={progress}
                  queueOrder={queueOrder}
                  onPlay={openPlayer}
                  onInfo={openDetail}
                />
              </div>
            </>
          )}
        </main>
      )}

      <footer className="app-footer">
        CineStream — local home network streaming. No accounts, no cloud.
      </footer>

      <TranscodingQueueDrawer
        isOpen={isQueueOpen}
        onClose={() => setIsQueueOpen(false)}
        movies={movies}
      />

      {detailMovie && (
        <MovieDetailModal
          movie={detailMovie}
          progress={progress[detailMovie.id]}
          onClose={() => setDetailId(null)}
          onPlay={openPlayer}
        />
      )}

      {playerMovie && (
        <VideoPlayer
          key={playerMovie.id}
          movie={playerMovie}
          onClose={() => setPlayerId(null)}
        />
      )}
    </div>
  );
};