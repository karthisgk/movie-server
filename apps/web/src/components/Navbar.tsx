import React, { useEffect, useState } from 'react';
import { Film, RefreshCw, Search, Server, X } from 'lucide-react';
import { PublicMovie } from '../types';

interface NavbarProps {
  movies: PublicMovie[];
  onOpenQueue: () => void;
  onRefresh: () => void;
  isRefreshing: boolean;
  searchQuery: string;
  onSearchChange: (value: string) => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  movies,
  onOpenQueue,
  onRefresh,
  isRefreshing,
  searchQuery,
  onSearchChange,
}) => {
  const [scrolled, setScrolled] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 30);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const processingCount = movies.filter(
    (m) => m.status === 'processing' || m.status === 'partial' || m.status === 'queued',
  ).length;

  const handleSearchBlur = () => {
    if (searchQuery.trim() === '') setSearchOpen(false);
  };

  return (
    <header className={`navbar ${scrolled ? 'is-scrolled' : ''}`}>
      <div className="navbar-inner">
        <button
          type="button"
          className="navbar-logo"
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
        >
          <span className="navbar-logo-mark">
            <Film size={22} />
          </span>
          <span className="navbar-logo-text">CineStream</span>
        </button>

        <nav className="navbar-links">
          <button type="button" className="navbar-link is-active" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
            Home
          </button>
          <button
            type="button"
            className="navbar-link"
            onClick={() =>
              document.getElementById('library')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
            }
          >
            Library
          </button>
          <button type="button" className="navbar-link" onClick={onOpenQueue}>
            Processing
            {processingCount > 0 && <span className="navbar-link-count">{processingCount}</span>}
          </button>
        </nav>

        <div className="navbar-actions">
          <div className={`navbar-search ${searchOpen ? 'is-open' : ''}`}>
            <Search size={18} />
            <input
              type="text"
              placeholder="Search titles"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              onFocus={() => setSearchOpen(true)}
              onBlur={handleSearchBlur}
              aria-label="Search titles"
            />
            {searchQuery && (
              <button type="button" onClick={() => onSearchChange('')} aria-label="Clear search">
                <X size={16} />
              </button>
            )}
          </div>

          <button
            type="button"
            className="navbar-icon-btn"
            onClick={onRefresh}
            aria-label="Refresh library"
            title="Refresh library"
          >
            <RefreshCw size={18} className={isRefreshing ? 'spin' : ''} />
          </button>

          <span className="navbar-health" title="Home LAN server online">
            <Server size={16} />
          </span>

          <span className="navbar-avatar" aria-hidden>
            C
          </span>
        </div>
      </div>
    </header>
  );
};