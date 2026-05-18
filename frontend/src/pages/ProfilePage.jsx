import React, { useState, useEffect } from 'react';
import { User, Mail, Building2, Save, ShieldCheck, Activity, Calendar, LogOut, CheckCircle } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import BackButton from '../components/BackButton';
import api from '../services/api';
import { isCompleted } from '../services/scanUtils';
import '../styles/profilePage.css';

export default function ProfilePage() {
  const toast = useToast();
  const { user, login, logout } = useAuth();
  const [form, setForm]         = useState({ name: user?.name || '', organization: user?.organization || '' });
  const [saved, setSaved]       = useState(false);
  const [stats, setStats]       = useState({ total: 0, completed: 0, highRisk: 0, successRate: 0 });

  useEffect(() => {
    api.getHistory().then(history => {
      const total     = history.length;
      const completed = history.filter(h => isCompleted(h)).length;
      const highRisk  = history.filter(h => isCompleted(h) && ['D','F'].includes((h.grade || '')[0])).length;
      const good      = history.filter(h => isCompleted(h) && (h.grade || '')[0] === 'A').length;
      setStats({
        total,
        completed,
        highRisk,
        successRate: total > 0 ? Math.round((good / total) * 100) : 0,
      });
    }).catch(() => toast?.error('Could not load profile statistics.'));
  }, [toast]);

  const handleSave = (e) => {
    e.preventDefault();
    const updated = { ...user, ...form };
    login(updated);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const set = (field) => (e) => setForm(f => ({ ...f, [field]: e.target.value }));

  const memberSince = user?.joinedAt
    ? new Date(user.joinedAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })
    : 'Unknown';

  return (
    <div className="profile-page animate-fade-up">
      <BackButton label="Back" fallback="/dashboard" />

      {/* ── Hero ── */}
      <div className="profile-hero glass-card">
        <div className="profile-avatar-large">
          {user?.avatarInitial || 'U'}
        </div>
        <div className="profile-hero__info">
          <h1 className="profile-hero__name">{user?.name || 'User'}</h1>
          <p className="profile-hero__email">{user?.email}</p>
          <div className="profile-hero__meta">
            <span className="badge badge--accent">
              <ShieldCheck size={11} /> Security Analyst
            </span>
            <span className="profile-hero__since">
              <Calendar size={12} /> Member since {memberSince}
            </span>
          </div>
        </div>
        <button className="profile-logout-btn" onClick={logout}>
          <LogOut size={15} /> Sign Out
        </button>
      </div>

      <div className="profile-body">

        {/* ── Edit form ── */}
        <div className="profile-form-card glass-card">
          <h2 className="profile-section-title">
            <User size={16} /> Profile Settings
          </h2>

          <form className="profile-form" onSubmit={handleSave}>
            <div className="pf-field">
              <label className="pf-label">Full Name</label>
              <div className="pf-input-wrap">
                <User size={15} className="pf-icon" />
                <input
                  className="pf-input"
                  type="text"
                  placeholder="Your full name"
                  value={form.name}
                  onChange={set('name')}
                />
              </div>
            </div>

            <div className="pf-field">
              <label className="pf-label">Email Address</label>
              <div className="pf-input-wrap pf-input-wrap--disabled">
                <Mail size={15} className="pf-icon" />
                <input
                  className="pf-input"
                  type="email"
                  value={user?.email || ''}
                  disabled
                />
              </div>
              <p className="pf-hint">Email cannot be changed in this version.</p>
            </div>

            <div className="pf-field">
              <label className="pf-label">Organization</label>
              <div className="pf-input-wrap">
                <Building2 size={15} className="pf-icon" />
                <input
                  className="pf-input"
                  type="text"
                  placeholder="Your company or team name"
                  value={form.organization}
                  onChange={set('organization')}
                />
              </div>
            </div>

            <button type="submit" className={`pf-save-btn ${saved ? 'pf-save-btn--saved' : ''}`}>
              {saved ? <><CheckCircle size={15} /> Saved!</> : <><Save size={15} /> Save Changes</>}
            </button>
          </form>
        </div>

        {/* ── Usage stats ── */}
        <div className="profile-stats-card glass-card">
          <h2 className="profile-section-title">
            <Activity size={16} /> Usage Statistics
          </h2>

          <div className="profile-stats-grid">
            {[
              { label: 'Total Scans',    value: stats.total,       color: 'var(--brand-primary)', suffix: '' },
              { label: 'Completed',      value: stats.completed,   color: 'var(--success)',       suffix: '' },
              { label: 'High Risk Found',value: stats.highRisk,    color: 'var(--error)',         suffix: '' },
              { label: 'Success Rate',   value: stats.successRate, color: 'var(--info)',          suffix: '%' },
            ].map(({ label, value, color, suffix }) => (
              <div key={label} className="ps-stat">
                <div className="ps-stat__value" style={{ color }}>{value}{suffix}</div>
                <div className="ps-stat__label">{label}</div>
              </div>
            ))}
          </div>

          <div className="profile-api-section">
            <div className="profile-section-title" style={{ fontSize:'0.82rem', marginBottom:'10px' }}>
              API Configuration
            </div>
            <div className="pf-api-row">
              <span className="pf-api-label">AI Engine</span>
              <span className="badge badge--accent">Groq · llama-3.3-70b</span>
            </div>
            <div className="pf-api-row">
              <span className="pf-api-label">Database</span>
              <span className="badge badge--success">MongoDB Atlas</span>
            </div>
            <div className="pf-api-row">
              <span className="pf-api-label">Backend</span>
              <span className="badge badge--accent">FastAPI · localhost:8000</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
