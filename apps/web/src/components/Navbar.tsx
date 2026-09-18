import React from 'react';
import { Film, Activity, ListOrdered, RefreshCw, Cpu } from 'lucide-react';
import { PublicMovie } from '../types';

interface NavbarProps {
  movies: PublicMovie[];
  onOpenQueue: () => void;
  onRefresh: () => void;
  isRefreshing: boolean;
}

export const Navbar: React.FC<NavbarProps> = ({
  movies,
  onOpenQueue,
  onRefresh,
  isRefreshing,
}) => {
  const activeMovie = movies.find(
    (m) => m.status === 'processing' || (m.status === 'partial' && (m.transcodingProgress ?? 0) < 100)
  );

  const queuedCount = movies.filter((m) => m.status === 'queued').length;
  const totalTranscoding = (activeMovie ? 1 : 0) + queuedCount;

  return (
    <header className="glass-panel" style={{ position: 'sticky', top: 0, zIndex: 50, margin: '16px 24px 0 24px', padding: '14px 24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        
        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{
            background: 'linear-gradient(135deg, #00f2fe 0%, #4facfe 100%)',
            padding: '10px',
            borderRadius: '12px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 0 15px rgba(0, 242, 254, 0.4)',
          }}>
            <Film size={24} color="#0a0d14" />
          </div>
          <div>
            <h1 style={{ fontSize: '1.25rem', fontWeight: 800, letterSpacing: '-0.02em', background: 'linear-gradient(90deg, #ffffff, #94a3b8)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
              CineStream
            </h1>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent-emerald)', display: 'inline-block' }}></span>
              Home LAN Server
            </span>
          </div>
        </div>

        {/* Center: Live Active Transcode Worker Status */}
        {activeMovie && (
          <div
            onClick={onOpenQueue}
            style={{
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              padding: '8px 16px',
              background: 'rgba(0, 242, 254, 0.08)',
              border: '1px solid rgba(0, 242, 254, 0.3)',
              borderRadius: 'var(--radius-full)',
              transition: 'all 0.2s ease',
            }}
            className="pulse-glow"
          >
            <Cpu size={16} className="spin" color="var(--accent-cyan)" />
            <div style={{ fontSize: '0.85rem' }}>
              <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                {activeMovie.title}
              </span>
              <span style={{ margin: '0 8px', color: 'rgba(255,255,255,0.3)' }}>|</span>
              <span style={{ fontWeight: 700, color: 'var(--accent-cyan)' }}>
                {activeMovie.transcodingProgress ?? 0}%
              </span>
              {activeMovie.transcodingProfile && (
                <span style={{ marginLeft: 6, fontSize: '0.75rem', padding: '2px 6px', background: 'rgba(0,0,0,0.4)', borderRadius: 4, color: 'var(--text-secondary)' }}>
                  {activeMovie.transcodingProfile}
                </span>
              )}
            </div>
          </div>
        )}

        {/* Right Action Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          
          {/* Queue Button */}
          <button
            onClick={onOpenQueue}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '8px 16px',
              background: totalTranscoding > 0 ? 'rgba(255, 159, 10, 0.12)' : 'rgba(255, 255, 255, 0.05)',
              border: totalTranscoding > 0 ? '1px solid rgba(255, 159, 10, 0.3)' : '1px solid var(--border-glass)',
              borderRadius: 'var(--radius-md)',
              color: totalTranscoding > 0 ? 'var(--accent-amber)' : 'var(--text-primary)',
              cursor: 'pointer',
              fontWeight: 600,
              fontSize: '0.85rem',
              transition: 'all 0.2s ease',
            }}
          >
            <ListOrdered size={16} />
            <span>Transcode Queue</span>
            {totalTranscoding > 0 && (
              <span style={{
                background: 'var(--accent-amber)',
                color: '#000',
                fontSize: '0.75rem',
                fontWeight: 800,
                borderRadius: '50%',
                width: 18,
                height: 18,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}>
                {totalTranscoding}
              </span>
            )}
          </button>

          {/* Refresh Button */}
          <button
            onClick={onRefresh}
            title="Refresh movie library"
            style={{
              padding: '8px',
              background: 'rgba(255, 255, 255, 0.05)',
              border: '1px solid var(--border-glass)',
              borderRadius: 'var(--radius-md)',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <RefreshCw size={16} className={isRefreshing ? 'spin' : ''} />
          </button>

        </div>

      </div>
    </header>
  );
};
