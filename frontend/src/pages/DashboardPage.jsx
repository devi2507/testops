import React, { useEffect, useState } from 'react';
import {
  ScanLine, ShieldCheck, AlertTriangle, XOctagon,
  Plus, ArrowRight, Clock, Globe, Code, Database, Layers,
  RefreshCcw, CheckCircle, XCircle, History as HistoryIcon
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import { isCancelled, isCompleted, needsReview } from '../services/scanUtils';
import '../styles/dashboard.css';

const INPUT_ICON = { codebase: Code, database: Database, both: Layers, url: Globe };
const INPUT_LABEL = { codebase: 'Codebase', database: 'Database', both: 'Full Stack', url: 'URL Scan' };

const gradeColor = (g = '') => {
  const normalized = String(g).toLowerCase();
  if (normalized.startsWith('cancel')) return 'var(--text-muted)';
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
  const [showConnModal, setShowConnModal] = useState(false);
  const [testUrl, setTestUrl] = useState(api.baseUrl);
  const [testStatus, setTestStatus] = useState(null);
  const [testMsg, setTestMsg] = useState('');

  const handleTestConnection = async () => {
    if (!testUrl) return;
    setTestStatus('loading');
    setTestMsg('Connecting to backend...');
    try {
      const cleanUrl = testUrl.trim().replace(/\/$/, '');
      let active = false;
      try {
        const r1 = await fetch(`${cleanUrl}/health`, { method: 'GET' });
        if (r1.ok) active = true;
      } catch {}
      
      if (!active) {
        try {
          const r2 = await fetch(`${cleanUrl}/api/health`, { method: 'GET' });
          if (r2.ok) active = true;
        } catch {}
      }

      if (active) {
        setTestStatus('success');
        setTestMsg('Connected successfully! Backend is active.');
      } else {
        setTestStatus('error');
        setTestMsg('Unable to connect. Check URL or verify backend is online.');
      }
    } catch (e) {
      setTestStatus('error');
      setTestMsg('Connection failed. Network error.');
    }
  };

  const handleSaveConnection = () => {
    if (testUrl) {
      api.setBackendUrl(testUrl);
      setShowConnModal(false);
      window.location.reload();
    }
  };

  const handleResetConnection = () => {
    api.resetBackendUrl();
    setShowConnModal(false);
    window.location.reload();
  };

  useEffect(() => {
    const abortCtrl = new AbortController();

    const checkBackend = async () => {
      try {
        await api.waitForBackend();
        const data = await api.getHistory({ signal: abortCtrl.signal });
        setHistory(data);
        setBackendOk(true);
      } catch (e) {
        if (e.name !== 'AbortError') setBackendOk(false);
      } finally {
        setLoading(false);
      }
    };

    checkBackend();
    
    const handleFocus = async () => {
      if (document.visibilityState === 'visible') {
        try {
          const data = await api.getHistory({ signal: abortCtrl.signal });
          setHistory(data);
        } catch (e) {}
      }
    };
    window.addEventListener('visibilitychange', handleFocus);
    window.addEventListener('focus', handleFocus);
    
    return () => {
      abortCtrl.abort();
      window.removeEventListener('visibilitychange', handleFocus);
      window.removeEventListener('focus', handleFocus);
    };
  }, []);

  useEffect(() => {
    if (backendOk !== false) return undefined;

    const poll = setInterval(async () => {
      try {
        await api.waitForBackend({ attempts: 3, interval: 1000 });
        const data = await api.getHistory();
        setHistory(data);
        setBackendOk(true);
      } catch {
        // keep retrying until backend is available
      }
    }, 5000);

    return () => clearInterval(poll);
  }, [backendOk]);

  // ── Derived stats ──
  const totalScans        = history.length;
  const completedScans    = history.filter(h => isCompleted(h)).length;
  const criticalVulns     = history.reduce((sum, h) => {
    if (!isCompleted(h)) return sum;
    const l = (h.grade || '')[0];
    return sum + (l === 'D' || l === 'F' ? (h.bugsFound || 0) : 0);
  }, 0);
  const needsReviewCount  = history.filter(h => needsReview(h)).length;
  const cancelledCount    = history.filter(h => isCancelled(h)).length;
  
  const recentScans = history.slice(0, 6);

  const greetingHour = new Date().getHours();
  const greeting = greetingHour < 12 ? 'Good morning' : greetingHour < 17 ? 'Good afternoon' : 'Good evening';

  const STATS = [
    { label: 'Total Scans', value: totalScans, icon: ScanLine,       color: 'var(--brand-primary)', bg: 'rgba(99,102,241,0.1)',  onClick: () => openHistory() },
    { label: 'Completed',   value: completedScans, icon: ShieldCheck, color: 'var(--success)',       bg: 'var(--success-bg)',     onClick: () => openHistory('completed') },
    { label: 'Needs Review', value: needsReviewCount, icon: AlertTriangle, color: 'var(--warning)', bg: 'rgba(245,158,11,0.1)', onClick: () => openHistory('review') },
    { label: 'Cancelled',    value: cancelledCount,   icon: XOctagon,     color: 'var(--error)',      bg: 'var(--error-bg)',      onClick: () => openHistory('cancelled') },
  ];

  const navigate = useNavigate();

  const openHistory = (view) => {
    const url = view ? `/history?view=${view}` : '/history';
    navigate(url);
  };

  return (
    <div className="dashboard animate-fade-up">

      {/* ── Backend offline banner ── */}
      {backendOk === false && (
        <div className="dash-offline-banner">
          <XCircle size={16} />
          <span>
            Backend is offline or starting up — it will reconnect automatically once available.
          </span>
          <button className="dash-offline-config-btn" onClick={() => setShowConnModal(true)}>
            <RefreshCcw size={11} /> Configure Connection
          </button>
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
          <div
            key={i}
            className="stat-card glass-card"
            style={{ '--stat-delay': `${i * 60}ms`, cursor: s.onClick ? 'pointer' : 'default' }}
            onClick={s.onClick}
          >
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
                    <tr 
                      key={scan.id} 
                      onClick={() => navigate(`/reports/${scan.id}`)}
                      style={{ cursor: 'pointer' }}
                      className="clickable-row"
                    >
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
                          {scan.status === 'cancelled' ? 'Cancelled' : scan.grade || '—'}
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
                        {scan.status === 'cancelled' ? (
                          <span className="badge badge--warning">
                            <AlertTriangle size={10} />
                            Cancelled
                          </span>
                        ) : (
                          <span className="badge badge--success">
                            <CheckCircle size={10} />
                            Completed
                          </span>
                        )}
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

      {/* ── Connection Modal ── */}
      {showConnModal && (
        <div className="conn-modal-overlay" onClick={() => setShowConnModal(false)}>
          <div className="conn-modal animate-fade-up" onClick={(e) => e.stopPropagation()}>
            <div className="conn-modal__header">
              <h3 className="conn-modal__title">
                <Globe size={18} color="var(--brand-primary)" />
                Connection Settings
              </h3>
              <button className="conn-modal__close" onClick={() => setShowConnModal(false)}>
                <XCircle size={18} />
              </button>
            </div>
            
            <div className="conn-modal__body">
              <p className="conn-modal__desc">
                If your backend is hosted on Render (which spins down after inactivity) or has a different URL, you can configure and test your custom backend connection here.
              </p>
              
              <div className="conn-modal__field">
                <label className="conn-modal__label">Backend Server URL</label>
                <div className="conn-modal__input-group">
                  <input
                    type="text"
                    className="conn-modal__input"
                    placeholder="https://your-backend.onrender.com"
                    value={testUrl}
                    onChange={(e) => {
                      setTestUrl(e.target.value);
                      setTestStatus(null);
                      setTestMsg('');
                    }}
                  />
                  <button
                    className="conn-modal__test-btn"
                    onClick={handleTestConnection}
                    disabled={!testUrl.trim() || testStatus === 'loading'}
                  >
                    {testStatus === 'loading' ? 'Testing...' : 'Test Connection'}
                  </button>
                </div>
              </div>

              {testStatus && (
                <div className={`conn-modal__status conn-modal__status--${testStatus}`}>
                  {testStatus === 'loading' && <RefreshCcw size={14} className="animate-spin" />}
                  {testStatus === 'success' && <CheckCircle size={14} />}
                  {testStatus === 'error' && <XOctagon size={14} />}
                  <span>{testMsg}</span>
                </div>
              )}
            </div>

            <div className="conn-modal__actions">
              <button
                className="conn-modal__btn conn-modal__btn--primary"
                onClick={handleSaveConnection}
                disabled={testStatus !== 'success'}
              >
                Save & Connect
              </button>
              <button
                className="conn-modal__btn conn-modal__btn--secondary"
                onClick={handleResetConnection}
              >
                Reset to Default
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
