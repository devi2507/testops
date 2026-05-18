import React, { useState, useEffect } from 'react';
import {
  History as HistoryIcon, Code, Database, Layers, Globe, X,
  Award, Bug, Trash2, ExternalLink, RefreshCcw, ChevronRight
} from 'lucide-react';
import api from '../services/api';
import './AuditHistory.css';

const INPUT_ICON = {
  codebase: Code,
  database: Database,
  both:     Layers,
  url:      Globe,
};

const INPUT_LABEL = {
  codebase: 'Codebase',
  database: 'Database',
  both:     'Full Stack',
  url:      'URL Scan',
};

const gradeColor = (g) => {
  if (!g) return 'var(--text-muted)';
  const l = g[0];
  if (l === 'A') return 'var(--success)';
  if (l === 'B') return '#22d3ee';
  if (l === 'C') return 'var(--warning)';
  return 'var(--error)';
};

function formatDate(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export default function AuditHistory({ open, onClose, onLoad }) {
  const [history, setHistory]   = useState([]);
  const [loading, setLoading]   = useState(false);
  const [clearing, setClearing] = useState(false);

  const fetchHistory = async () => {
    setLoading(true);
    try {
      const data = await api.getHistory();
      setHistory(data);
    } catch { /* backend offline */ }
    finally { setLoading(false); }
  };

  useEffect(() => {
    if (open) fetchHistory();
  }, [open]);

  const handleClear = async () => {
    if (!window.confirm('Delete all audit history? This cannot be undone.')) return;
    setClearing(true);
    try {
      await api.clearHistory();
      setHistory([]);
    } catch { /* ignore */ }
    finally { setClearing(false); }
  };

  const handleLoad = async (entry) => {
    try {
      const data = await api.getHistoryResult(entry.id);
      onLoad(data, entry.id);
      onClose();
    } catch (e) {
      alert('Could not load this report: ' + e.message);
    }
  };

  return (
    <>
      {/* Backdrop */}
      {open && <div className="hist-backdrop" onClick={onClose} />}

      {/* Slide-in panel */}
      <div className={`hist-panel ${open ? 'hist-panel--open' : ''}`}>
        <div className="hist-header">
          <div className="hist-header__left">
            <HistoryIcon size={18} color="var(--accent-light)" />
            <span className="hist-header__title">Audit History</span>
            <span className="hist-header__count">{history.length}</span>
          </div>
          <div className="hist-header__actions">
            {history.length > 0 && (
              <button
                className="hist-btn hist-btn--danger"
                onClick={handleClear}
                disabled={clearing}
                title="Clear all history"
              >
                <Trash2 size={14} />
              </button>
            )}
            <button className="hist-btn" onClick={fetchHistory} title="Refresh">
              <RefreshCcw size={14} className={loading ? 'spin' : ''} />
            </button>
            <button className="hist-btn" onClick={onClose} title="Close">
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="hist-body">
          {loading && (
            <div className="hist-empty">
              <div className="hist-spinner" />
              <p>Loading history…</p>
            </div>
          )}

          {!loading && history.length === 0 && (
            <div className="hist-empty">
              <HistoryIcon size={36} color="var(--text-muted)" />
              <p>No audits yet.<br />Complete a scan to see it here.</p>
            </div>
          )}

          {!loading && history.map((entry) => {
            const Icon  = INPUT_ICON[entry.inputType] || Code;
            const label = INPUT_LABEL[entry.inputType] || entry.inputType;
            const gc    = gradeColor(entry.grade);
            const shortTarget = (entry.target || '').length > 30
              ? '…' + entry.target.slice(-28)
              : (entry.target || '—');

            return (
              <div key={entry.id} className="hist-entry">
                <div className="hist-entry__icon">
                  <Icon size={16} color="var(--accent-light)" />
                </div>
                <div className="hist-entry__body">
                  <div className="hist-entry__target" title={entry.target}>
                    {shortTarget}
                  </div>
                  <div className="hist-entry__meta">
                    <span className="hist-tag">{label}</span>
                    <span className="hist-entry__date">{formatDate(entry.createdAt)}</span>
                  </div>
                  <div className="hist-entry__stats">
                    <span style={{ color: gc, fontWeight: 700 }}>{entry.grade}</span>
                    <span className="hist-dot" />
                    <span>{entry.securityScore}/100</span>
                    <span className="hist-dot" />
                    <Bug size={11} />
                    <span>{entry.bugsFound}</span>
                  </div>
                </div>
                <button
                  className="hist-entry__load"
                  onClick={() => handleLoad(entry)}
                  title="Load this report"
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
