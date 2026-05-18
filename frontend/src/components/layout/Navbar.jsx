import React from 'react';
import { Activity, Sun, Moon } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';

const PAGE_TITLES = {
  dashboard: 'Dashboard',
  scan:      'New Scan',
  history:   'Scan History',
  reports:   'Reports',
  profile:   'Profile',
};

export default function Navbar({ currentPage, activeScans = 0 }) {
  const { user } = useAuth();
  const { theme, toggle } = useTheme();

  return (
    <header className="navbar">
      <div className="navbar-left">
        <h2 className="navbar-title">{PAGE_TITLES[currentPage] || 'TestPilot AI'}</h2>
      </div>

      <div className="navbar-right">
        {/* Active scans indicator */}
        {activeScans > 0 && (
          <div className="navbar-active">
            <span className="navbar-active__dot" />
            <span>{activeScans} Active Scan{activeScans > 1 ? 's' : ''}</span>
          </div>
        )}

        {/* System status */}
        <div className="navbar-status">
          <Activity size={12} />
          <span>Online</span>
        </div>

        {/* Theme toggle */}
        <button
          className="navbar-theme-btn"
          onClick={toggle}
          title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
        >
          {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
        </button>

        {/* Avatar */}
        <div className="navbar-avatar" title={user?.name}>
          {user?.avatarInitial || 'U'}
        </div>
      </div>
    </header>
  );
}
