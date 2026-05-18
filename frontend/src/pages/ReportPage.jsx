import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ShieldCheck, RefreshCcw, Search, Calendar, Code, Database, Layers, Globe } from 'lucide-react';
import { useToast } from '../context/ToastContext';
import api from '../services/api';
import ResultsDashboard from '../components/ResultsDashboard';
import '../styles/reportPage.css';

const INPUT_ICON = { codebase: Code, database: Database, both: Layers, url: Globe };
const INPUT_LABEL = { codebase: 'Codebase', database: 'Database', both: 'Full Stack', url: 'URL Scan' };

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function gradeColor(g = '') {
  if (!g) return 'var(--text-muted)';
  const normalized = String(g).toLowerCase();
  if (normalized.startsWith('cancel')) return 'var(--text-muted)';
  const l = g[0];
  if (l === 'A') return 'var(--success)';
  if (l === 'B') return 'var(--info)';
  if (l === 'C') return 'var(--warning)';
  return 'var(--error)';
}

export default function ReportPage() {
  const toast = useToast();
  const navigate = useNavigate();
  const { reportId } = useParams();
  const [history, setHistory] = useState([]);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadingReport, setLoadingReport] = useState(false);

  useEffect(() => {
    const loadHistory = async () => {
      setLoading(true);
      try {
        setHistory(await api.getHistory());
      } catch {
        toast?.error('Could not load reports.');
      } finally {
        setLoading(false);
      }
    };
    loadHistory();
  }, [toast]);

  useEffect(() => {
    if (!reportId) {
      setSelected(null);
      return;
    }

    const loadReport = async () => {
      setLoadingReport(true);
      try {
        const data = await api.getHistoryResult(reportId);
        setSelected({ ...data, id: reportId });
      } catch {
        toast?.error('Could not load report details.');
      } finally {
        setLoadingReport(false);
      }
    };

    loadReport();
  }, [reportId, toast]);

  const openReport = (id) => navigate(`/reports/${id}`);
  const startScan = () => navigate('/scan');

  if (selected) {
    return (
      <ResultsDashboard
        results={selected}
        testId={selected.id}
        onReset={startScan}
        backTo="/reports"
        backLabel="Back to Reports"
      />
    );
  }

  return (
    <div className="rp-page animate-fade-up">
      <div className="rp-list-header">
        <div>
          <h1 className="rp-list-title">Reports</h1>
          <p className="rp-list-sub">Click any report to open the full security report layout shown after scan completion.</p>
        </div>
        <div className="rp-header-actions">
          <button className="rp-action-btn rp-action-btn--primary" onClick={startScan}>
            <RefreshCcw size={14} /> New Scan
          </button>
        </div>
      </div>

      {loading ? (
        <div className="rp-skeletons">
          {[...Array(4)].map((_, i) => <div key={i} className="rp-skeleton" />)}
        </div>
      ) : history.length === 0 ? (
        <div className="rp-empty glass-card">
          <ShieldCheck size={44} color="var(--text-muted)" />
          <h3>No reports available</h3>
          <p>Run a scan to generate your first detailed report.</p>
          <button className="rp-action-btn rp-action-btn--primary" onClick={startScan}>
            Start Scan
          </button>
        </div>
      ) : (
        <div className="rp-report-grid">
          {history.map((scan) => {
            const gc = gradeColor(scan.status === 'cancelled' ? 'Cancelled' : scan.grade);
            const Icon = INPUT_ICON[scan.inputType] || Code;
            const label = INPUT_LABEL[scan.inputType] || scan.inputType;
            return (
              <button
                key={scan.id}
                type="button"
                className="rp-report-card glass-card"
                onClick={() => openReport(scan.id)}
              >
                <div className="rp-rc__top">
                  {scan.status === 'cancelled' ? (
                    <div className="rp-rc__badge-cancelled">
                      Cancelled
                    </div>
                  ) : (
                    <div className="rp-rc__grade" style={{ color: gc, borderColor: gc, background: `${gc}18` }}>
                      {scan.grade || '?'}
                    </div>
                  )}
                  <div className="rp-rc__score" style={{ color: gc }}>
                    {scan.status === 'cancelled' ? '—' : scan.securityScore ?? '—'}
                    {scan.status !== 'cancelled' && <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>/100</span>}
                  </div>
                </div>
                <div className="rp-rc__target" title={scan.target}>
                  <Icon size={13} style={{ flexShrink: 0 }} />
                  <span>{scan.target?.length > 32 ? `…${scan.target.slice(-30)}` : (scan.target || 'Unknown')}</span>
                </div>
                <div className="rp-rc__footer">
                  <span className="badge badge--accent">{label}</span>
                  <span className="rp-rc__bugs" style={{ color: (scan.bugsFound || 0) > 5 ? 'var(--error)' : (scan.bugsFound || 0) > 0 ? 'var(--warning)' : 'var(--success)' }}>
                    {scan.bugsFound ?? 0} issues
                  </span>
                </div>
                <div className="rp-rc__date">
                  <Calendar size={11} />{formatDate(scan.createdAt)}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {loadingReport && (
        <div className="rp-loading-overlay">
          <div className="rp-loading-spinner" />
          <span>Loading report…</span>
        </div>
      )}
    </div>
  );
}
