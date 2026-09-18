import React, { useEffect, useState, useCallback } from 'react';
import { Navbar } from './components/Navbar';
import { MovieCard } from './components/MovieCard';
import { TranscodingQueueDrawer } from './components/TranscodingQueueDrawer';
import { VideoPlayerModal } from './components/VideoPlayerModal';
import { PublicMovie } from './types';
import { Search, Film, Cpu, CheckCircle2, Clock, Sparkles } from 'lucide-react';

export const App: React.FC = () => {
  const [movies, setMovies] = useState<PublicMovie[]>([]);
  const [isQueueOpen, setIsQueueOpen] = useState(false);
  const [selectedMovie, setSelectedMovie] = useState<PublicMovie | null>(null);
  const [activeFilter, setActiveFilter] = useState<'all' | 'processing' | 'ready' | 'queued'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);

  const fetchMovies = useCallback(async () => {
    try {
      setIsRefreshing(true);
      const res = await fetch('/videos');
      if (res.ok) {
        const data = (await res.json()) as PublicMovie[];
        setMovies(data);
      }
    } catch (err) {
      console.error('Failed to fetch movies:', err);
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  // Connect to Server-Sent Events (/videos/events) for zero-latency live push updates
  useEffect(() => {
    fetchMovies();

    const eventSource = new EventSource('/videos/events');

    eventSource.addEventListener('init', (e) => {
      try {
        const data = JSON.parse(e.data) as PublicMovie[];
        setMovies(data);
      } catch (err) {
        console.error('Failed to parse SSE init:', err);
      }
    });

    eventSource.addEventListener('update', (e) => {
      try {
        const data = JSON.parse(e.data) as PublicMovie[];
        setMovies(data);
      } catch (err) {
        console.error('Failed to parse SSE update:', err);
      }
    });

    eventSource.onerror = () => {
      // EventSource auto-reconnects natively when connection is lost
    };

    return () => {
      eventSource.close();
    };
  }, [fetchMovies]);

  // Active processing movie
  const activeMovie = movies.find(
    (m) => m.status === 'processing' || (m.status === 'partial' && (m.transcodingProgress ?? 0) < 100)
  );

  const queuedMovies = movies.filter((m) => m.status === 'queued');
  const readyMovies = movies.filter((m) => m.status === 'ready' || m.status === 'partial');

  // Filter & Search logic
  const filteredMovies = movies.filter((m) => {
    const matchesSearch = m.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      m.filename.toLowerCase().includes(searchQuery.toLowerCase());

    if (!matchesSearch) return false;

    if (activeFilter === 'processing') return m.status === 'processing' || m.status === 'partial';
    if (activeFilter === 'ready') return m.status === 'ready' || m.status === 'partial';
    if (activeFilter === 'queued') return m.status === 'queued';
    return true;
  });

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', paddingBottom: '60px' }}>
      
      {/* Navigation Bar */}
      <Navbar
        movies={movies}
        onOpenQueue={() => setIsQueueOpen(true)}
        onRefresh={fetchMovies}
        isRefreshing={isRefreshing}
      />

      {/* Main Content Area */}
      <main style={{ maxWidth: '1440px', margin: '0 auto', width: '100%', padding: '24px' }}>
        
        {/* Active Transcoding Spotlight Banner if a movie is actively transcoding */}
        {activeMovie && (
          <div className="glass-card" style={{
            margin: '0 0 32px 0',
            padding: '28px',
            background: 'linear-gradient(135deg, rgba(0, 242, 254, 0.08) 0%, rgba(157, 78, 221, 0.08) 100%)',
            border: '1px solid rgba(0, 242, 254, 0.3)',
            position: 'relative',
            overflow: 'hidden',
          }}>
            <div style={{ position: 'relative', zIndex: 2 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                <span className="badge badge-processing">
                  <Cpu size={14} className="spin" /> Multi-Thread Worker Transcoding
                </span>
                <span style={{ fontSize: '0.8rem', color: 'var(--accent-cyan)', fontWeight: 600 }}>
                  Interstellar / Active Stream Processing
                </span>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: '16px' }}>
                <div>
                  <h2 style={{ fontSize: '1.8rem', fontWeight: 800, color: 'var(--text-primary)', marginBottom: '4px' }}>
                    {activeMovie.title}
                  </h2>
                  <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                    Transcoding parallel resolutions ({activeMovie.transcodingProfile || '720p + 1080p'})
                  </p>
                </div>

                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '2.5rem', fontWeight: 900, color: 'var(--accent-cyan)', lineHeight: 1 }}>
                    {activeMovie.transcodingProgress ?? 0}%
                  </div>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    Combined Worker Progress out of 100%
                  </span>
                </div>
              </div>

              {/* Progress bar */}
              <div style={{ width: '100%', height: 10, background: 'rgba(255,255,255,0.08)', borderRadius: 5, overflow: 'hidden', marginTop: '18px' }}>
                <div
                  className="progress-active-bar"
                  style={{
                    width: `${activeMovie.transcodingProgress ?? 0}%`,
                    height: '100%',
                    borderRadius: 5,
                    transition: 'width 0.4s ease',
                  }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '10px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                <span>Completed Variants: {(activeMovie.completedProfiles ?? []).join(', ') || 'None so far'}</span>
                <span>Queued Next: {queuedMovies.length} movie(s)</span>
              </div>
            </div>
          </div>
        )}

        {/* Filter & Search Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', marginBottom: '24px', flexWrap: 'wrap' }}>
          
          {/* Filter Tabs */}
          <div style={{ display: 'flex', gap: '8px', background: 'rgba(255,255,255,0.03)', padding: '4px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-glass)' }}>
            <button
              onClick={() => setActiveFilter('all')}
              style={{
                padding: '8px 16px',
                borderRadius: 'var(--radius-sm)',
                border: 'none',
                background: activeFilter === 'all' ? 'rgba(255,255,255,0.1)' : 'transparent',
                color: activeFilter === 'all' ? 'var(--text-primary)' : 'var(--text-secondary)',
                fontWeight: activeFilter === 'all' ? 700 : 500,
                fontSize: '0.85rem',
                cursor: 'pointer',
              }}
            >
              All ({movies.length})
            </button>
            <button
              onClick={() => setActiveFilter('ready')}
              style={{
                padding: '8px 16px',
                borderRadius: 'var(--radius-sm)',
                border: 'none',
                background: activeFilter === 'ready' ? 'rgba(48, 209, 88, 0.15)' : 'transparent',
                color: activeFilter === 'ready' ? 'var(--accent-emerald)' : 'var(--text-secondary)',
                fontWeight: activeFilter === 'ready' ? 700 : 500,
                fontSize: '0.85rem',
                cursor: 'pointer',
              }}
            >
              Playable ({readyMovies.length})
            </button>
            <button
              onClick={() => setActiveFilter('processing')}
              style={{
                padding: '8px 16px',
                borderRadius: 'var(--radius-sm)',
                border: 'none',
                background: activeFilter === 'processing' ? 'rgba(0, 242, 254, 0.15)' : 'transparent',
                color: activeFilter === 'processing' ? 'var(--accent-cyan)' : 'var(--text-secondary)',
                fontWeight: activeFilter === 'processing' ? 700 : 500,
                fontSize: '0.85rem',
                cursor: 'pointer',
              }}
            >
              Transcoding ({activeMovie ? 1 : 0})
            </button>
            <button
              onClick={() => setActiveFilter('queued')}
              style={{
                padding: '8px 16px',
                borderRadius: 'var(--radius-sm)',
                border: 'none',
                background: activeFilter === 'queued' ? 'rgba(255, 159, 10, 0.15)' : 'transparent',
                color: activeFilter === 'queued' ? 'var(--accent-amber)' : 'var(--text-secondary)',
                fontWeight: activeFilter === 'queued' ? 700 : 500,
                fontSize: '0.85rem',
                cursor: 'pointer',
              }}
            >
              Queued ({queuedMovies.length})
            </button>
          </div>

          {/* Search Box */}
          <div style={{ position: 'relative', width: '280px' }}>
            <Search size={16} color="var(--text-muted)" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }} />
            <input
              type="text"
              placeholder="Search movie library..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                width: '100%',
                padding: '10px 12px 10px 36px',
                background: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid var(--border-glass)',
                borderRadius: 'var(--radius-md)',
                color: 'var(--text-primary)',
                fontSize: '0.85rem',
                outline: 'none',
              }}
            />
          </div>

        </div>

        {/* Movies Grid */}
        {filteredMovies.length > 0 ? (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
            gap: '24px',
          }}>
            {filteredMovies.map((movie) => {
              const qIndex = queuedMovies.findIndex((q) => q.id === movie.id);
              return (
                <MovieCard
                  key={movie.id}
                  movie={movie}
                  queuePosition={qIndex !== -1 ? qIndex + 1 : undefined}
                  onPlay={(m) => setSelectedMovie(m)}
                />
              );
            })}
          </div>
        ) : (
          <div style={{ padding: '60px', textAlign: 'center', background: 'rgba(255,255,255,0.02)', borderRadius: 'var(--radius-lg)', border: '1px dashed var(--border-glass)' }}>
            <Film size={48} color="var(--text-muted)" style={{ marginBottom: '16px' }} />
            <h3 style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>
              No movies found
            </h3>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              No movies match your current search or filter criteria.
            </p>
          </div>
        )}

      </main>

      {/* Transcoding Queue Drawer Modal */}
      <TranscodingQueueDrawer
        isOpen={isQueueOpen}
        onClose={() => setIsQueueOpen(false)}
        movies={movies}
      />

      {/* HLS Video Player Modal */}
      {selectedMovie && (
        <VideoPlayerModal
          movie={selectedMovie}
          onClose={() => setSelectedMovie(null)}
        />
      )}

    </div>
  );
};
