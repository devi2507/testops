import React from 'react';
import {
  Shield, LayoutDashboard, ScanLine, History as HistoryIcon,
  FileText, User, LogOut, ChevronRight
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import '../../styles/layout.css';

const NAV = [
  { id: 'dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { id: 'scan',      icon: ScanLine,         label: 'New Scan' },
  { id: 'history', icon: HistoryIcon, label: 'Scan History' },
  { id: 'reports',   icon: FileText,          label: 'Reports' },
  { id: 'profile',   icon: User,              label: 'Profile' },
];

export default function Sidebar({ currentPage, onNavigate }) {
  const { user, logout } = useAuth();

  return (
    <aside className="sidebar">
      {/* ── Brand ── */}
      <div className="sidebar-brand">
        <div className="sidebar-brand__icon">
          <Shield size={20} color="#fff" />
        </div>
        <div className="sidebar-brand__text">
          <span className="sidebar-brand__name">TestPilot AI</span>
          <span className="sidebar-brand__sub">Security Platform</span>
        </div>
      </div>

      <div className="sidebar-divider" />

      {/* ── Navigation ── */}
      <nav className="sidebar-nav">
        {NAV.map(({ id, icon: Icon, label }) => (
          <button
            key={id}
            className={`sidebar-nav-item ${currentPage === id ? 'sidebar-nav-item--active' : ''}`}
            onClick={() => onNavigate(id)}
          >
            <Icon size={17} />
            <span>{label}</span>
            {currentPage === id && <ChevronRight size={14} className="sidebar-nav-item__arrow" />}
          </button>
        ))}
      </nav>

      {/* ── User / Logout ── */}
      <div className="sidebar-footer">
        <div className="sidebar-user">
          <div className="sidebar-user__avatar">
            {user?.avatarInitial || 'U'}
          </div>
          <div className="sidebar-user__info">
            <div className="sidebar-user__name">{user?.name || 'User'}</div>
            <div className="sidebar-user__email">{user?.email}</div>
          </div>
        </div>
        <button className="sidebar-logout" onClick={logout} title="Sign out">
          <LogOut size={16} />
        </button>
      </div>
    </aside>
  );
}
