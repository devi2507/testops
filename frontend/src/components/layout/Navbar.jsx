import React from 'react';
import { Activity, Sun, Moon, PlayCircle, CheckCircle, AlertTriangle, FileText, Loader2 } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { useActiveScan } from '../../context/ActiveScanContext';

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
  const { activeScan, clearActiveScan } = useActiveScan();
  const location = useLocation();

  const isWidgetVisible = () => {
    if (!activeScan) return false;
    const path = location.pathname;
    // Hide if we are on the live scan page for this scan
    if (path.includes(`/scan/live/${activeScan.scanId}`)) return false;
    // Hide if we are on the specific report page for this scan
    if (path.includes(`/reports/${activeScan.scanId}`)) return false;
    // Also hide if we are on the general reports page and the scan is already completed
    if (path === '/reports' && activeScan.currentStatus === 'completed') return false;
    return true;
  };

  return (
    <header className="navbar">
      <div className="navbar-left">
        <h2 className="navbar-title">{PAGE_TITLES[currentPage] || 'TestPilot AI'}</h2>
      </div>

      <div className="navbar-right">
        {/* Global Active Scan Widget */}
        {isWidgetVisible() && (
          <div className="navbar-scan-widget">
            <div className="navbar-scan-widget__info">
              {activeScan.currentStatus === 'running' && <Loader2 size={14} className="spin" style={{ color: 'var(--brand-primary)' }} />}
              {activeScan.currentStatus === 'completed' && <CheckCircle size={14} style={{ color: 'var(--success)' }} />}
              {(activeScan.currentStatus === 'error' || activeScan.currentStatus === 'cancelled') && <AlertTriangle size={14} style={{ color: 'var(--error)' }} />}
              <span className="navbar-scan-widget__name">{activeScan.targetName || 'Scan'}</span>
            </div>
            
            {activeScan.currentStatus === 'running' && (
              <div className="navbar-scan-widget__progress">
                <div className="navbar-scan-widget__bar" style={{ width: `${activeScan.currentProgress || 0}%` }} />
              </div>
            )}

            <div className="navbar-scan-widget__actions">
              {activeScan.currentStatus === 'running' && (
                <Link to={activeScan.routePath} className="navbar-scan-widget__btn">
                  <PlayCircle size={12} /> Resume
                </Link>
              )}
              {activeScan.currentStatus === 'completed' && (
                <Link to={`/reports/${activeScan.scanId}`} className="navbar-scan-widget__btn navbar-scan-widget__btn--success" onClick={() => clearActiveScan()}>
                  <FileText size={12} /> View Report
                </Link>
              )}
              {(activeScan.currentStatus === 'error' || activeScan.currentStatus === 'cancelled') && (
                <Link to={activeScan.routePath} className="navbar-scan-widget__btn navbar-scan-widget__btn--error" onClick={() => clearActiveScan()}>
                  <AlertTriangle size={12} /> Details
                </Link>
              )}
            </div>
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
