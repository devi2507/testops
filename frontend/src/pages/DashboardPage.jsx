import React, { useEffect, useState } from 'react';
import {
  ScanLine, ShieldCheck, AlertTriangle, TrendingUp,
  Plus, ArrowRight, Clock, Globe, Code, Database, Layers,
  RefreshCcw, CheckCircle, XCircle, History as HistoryIcon
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import '../styles/dashboard.css';

const INPUT_ICON = { codebase: Code, database: Database, both: Layers, url: Globe };
const INPUT_LABEL = { codebase: 'Codebase', database: 'Database', both: 'Full Stack', url: 'URL Scan' };

const gradeColor = (g = '') => {
  const l = g[0];
  if (l === 'A') return 'var(--success)';
  if (l === 'B') return 'var(--info)';
  if (l === 'C') return 'var(--warning)';
  return 'var(--error)';
};

function formatDate(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' }); }
  catch { return iso; }
}

export default function DashboardPage({ onNavigate }) {
  const { user } = useAuth();
  const [history, setHistory]   = useState([]);
  const [loading, setLoading]   = useState(true);
  const [backendOk, setBackendOk] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const data = await api.getHistory();
        setHistory(data);
        setBackendOk(true);
      } catch {
        setBackendOk(false);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // ── Derived stats ──
  const totalScans        = history.length;
  const completedScans    = history.filter(h => h.grade).length;
  const criticalVulns     = history.reduce((sum, h) => {
    if (!h.grade) return sum;
    const l = h.grade[0];
    return sum + (l === 'D' || l === 'F' ? (h.bugsFound || 0) : 0);
  }, 0);
  const successRate = totalScans > 0
    ? Math.round(history.filter(h => h.grade && (h.grade[0] === 'A' || h.grade[0] === 'B')).length / totalScans * 100)
    : 0;

  const recentScans = history.slice(0, 6);

  const greetingHour = new Date().getHours();
  const greeting = greetingHour < 12 ? 'Good morning' : greetingHour < 17 ? 'Good afternoon' : 'Good evening';

  const STATS = [
    { label: 'Total Scans', value: totalScans, icon: ScanLine,       color: 'var(--brand-primary)', bg: 'rgba(99,102,241,0.1)',  change: null },
    { label: 'Completed',   value: completedScans, icon: ShieldCheck, color: 'var(--success)',       bg: 'var(--success-bg)',     change: null },
    { label: 'Critical Findings', value: criticalVulns, icon: AlertTriangle, color: 'var(--error)', bg: 'var(--error-bg)',       change: null },
    { label: 'Success Rate', value: `${successRate}%`, icon: TrendingUp, color: 'var(--info)',      bg: 'var(--info-bg)',        change: null },
  ];

  return (
    <div className="dashboard animate-fade-up">

      {/* ── Backend offline banner ── */}
      {backendOk === false && (
        <div className="dash-offline-banner">
          <XCircle size={16} />
          Backend is offline — start it on port 8000 to see your audit data.
        </div>
      )}

      {/* ── Welcome ── */}
      <section className="dash-welcome">
        <div className="dash-welcome__left">
          <p className="dash-welcome__greeting">{greeting}, {user?.name?.split(' ')[0] || 'there'} 👋</p>
          <h1 className="dash-welcome__title">Security Audit Dashboard</h1>
          <p className="dash-welcome__sub">
            Monitor your AI-powered security scans, track vulnerabilities, and generate detailed reports.
          </p>
        </div>
        <button className="dash-cta" onClick={() => onNavigate('scan')}>
          <Plus size={17} />
          Start New Scan
          <ArrowRight size={15} />
        </button>
      </section>

      {/* ── Stat Cards ── */}
      <section className="dash-stats">
        {STATS.map((s, i) => (
          <div key={i} className="stat-card glass-card" style={{ '--stat-delay': `${i * 60}ms` }}>
            <div className="stat-card__header">
              <span className="stat-card__label">{s.label}</span>
              <div className="stat-card__icon-wrap" style={{ background: s.bg }}>
                <s.icon size={18} color={s.color} />
              </div>
            </div>
            {loading ? (
              <div className="stat-card__skeleton" />
            ) : (
              <div className="stat-card__value" style={{ color: s.color }}>{s.value}</div>
            )}
            <div className="stat-card__sub">All time</div>
          </div>
        ))}
      </section>

      {/* ── Recent Scans ── */}
      <section className="dash-section">
        <div className="dash-section__header">
          <h2 className="dash-section__title">Recent Scans</h2>
          <button className="dash-section__link" onClick={() => onNavigate('history')}>
            View all <ArrowRight size={14} />
          </button>
        </div>

        {loading && (
          <div className="dash-table-skeleton">
            {[...Array(4)].map((_,i) => <div key={i} className="skeleton-row" />)}
          </div>
        )}

        {!loading && recentScans.length === 0 && (
          <div className="dash-empty glass-card">
            <ScanLine size={40} color="var(--text-muted)" />
            <h3>No scans yet</h3>
            <p>Start your first security audit to see results here.</p>
            <button className="dash-empty__cta" onClick={() => onNavigate('scan')}>
              <Plus size={15} /> Start Scan
            </button>
          </div>
        )}

        {!loading && recentScans.length > 0 && (
          <div className="dash-table glass-card">
            <table>
              <thead>
                <tr>
                  <th>Target</th>
                  <th>Type</th>
                  <th>Grade</th>
                  <th>Score</th>
                  <th>Bugs</th>
                  <th>Date</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {recentScans.map((scan) => {
                  const Icon  = INPUT_ICON[scan.inputType] || Code;
                  const label = INPUT_LABEL[scan.inputType] || scan.inputType;
                  const gc    = gradeColor(scan.grade);
                  const short = (scan.target || '—').length > 28
                    ? '…' + scan.target.slice(-26) : (scan.target || '—');
                  return (
                    <tr key={scan.id}>
                      <td>
                        <div className="scan-target">
                          <div className="scan-target__icon">
                            <Icon size={13} />
                          </div>
                          <span title={scan.target}>{short}</span>
                        </div>
                      </td>
                      <td><span className="badge badge--accent">{label}</span></td>
                      <td>
                        <span className="scan-grade" style={{ color: gc }}>
                          {scan.grade || '—'}
                        </span>
                      </td>
                      <td>
                        <div className="score-bar">
                          <div
                            className="score-bar__fill"
                            style={{ width: `${scan.securityScore || 0}%`, background: gc }}
                          />
                        </div>
                        <span className="score-bar__label">{scan.securityScore ?? '—'}</span>
                      </td>
                      <td>
                        <span className={`badge ${(scan.bugsFound || 0) > 5 ? 'badge--error' : (scan.bugsFound || 0) > 0 ? 'badge--warning' : 'badge--success'}`}>
                          {scan.bugsFound ?? 0}
                        </span>
                      </td>
                      <td>
                        <div className="scan-date">
                          <Clock size={12} />
                          {formatDate(scan.createdAt)}
                        </div>
                      </td>
                      <td>
                        <span className="badge badge--success">
                          <CheckCircle size={10} />
                          Completed
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── Quick Actions ── */}
      <section className="dash-section">
        <div className="dash-section__header">
          <h2 className="dash-section__title">Quick Actions</h2>
        </div>
        <div className="dash-quick-actions">
          {[
            { icon: Code,     label: 'Scan Codebase',      sub: 'Upload ZIP archive', color: 'var(--brand-primary)', page: 'scan' },
            { icon: Globe,    label: 'URL Security Scan',  sub: 'Black-box HTTP probe', color: 'var(--info)',         page: 'scan' },
            { icon: HistoryIcon, label: 'View History',       sub: 'Browse past audits',  color: 'var(--success)',       page: 'history' },
            { icon: RefreshCcw, label: 'Re-run Last Scan', sub: 'Use previous config', color: 'var(--warning)',       page: 'scan' },
          ].map(({ icon: Icon, label, sub, color, page }, i) => (
            <button key={i} className="quick-action glass-card" onClick={() => onNavigate(page)}>
              <div className="quick-action__icon" style={{ color, background: `${color}18` }}>
                <Icon size={20} />
              </div>
              <div className="quick-action__text">
                <span className="quick-action__label">{label}</span>
                <span className="quick-action__sub">{sub}</span>
              </div>
              <ArrowRight size={15} color="var(--text-muted)" />
            </button>
          ))}
        </div>
      </section>

    </div>
  );
}
