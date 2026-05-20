import React, { useState, useEffect } from 'react';
import {
  Search, Filter, Trash2, Eye, Download, RefreshCcw,
  Code, Database, Layers, Globe, Calendar, Bug,
  ChevronLeft, ChevronRight, AlertTriangle, ShieldCheck, Plus, ScanLine
} from 'lucide-react';
import { jsPDF } from 'jspdf';
import { useLocation, useNavigate } from 'react-router-dom';
import BackButton from '../components/BackButton';
import { useToast } from '../context/ToastContext';
import api from '../services/api';
import { isCancelled, isCompleted, needsReview } from '../services/scanUtils';
import '../styles/historyPage.css';

const INPUT_ICON  = { codebase: Code, database: Database, both: Layers, url: Globe };
const INPUT_LABEL = { codebase: 'Codebase', database: 'Database', both: 'Full Stack', url: 'URL Scan' };

const gradeColor = g => {
  if (!g) return 'var(--text-muted)';
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
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function quickExport(scan) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const m = 44; let y = m;
  doc.setFillColor(12,12,28); doc.rect(0,0,doc.internal.pageSize.getWidth(),80,'F');
  doc.setFillColor(99,102,241); doc.rect(0,0,5,80,'F');
  doc.setFontSize(20); doc.setFont('helvetica','bold'); doc.setTextColor(255,255,255);
  doc.text('TestOps Security Report', m, 34);
  doc.setFontSize(10); doc.setFont('helvetica','normal'); doc.setTextColor(160,160,200);
  doc.text(`Target: ${scan.target||'N/A'}  ·  Grade: ${scan.grade||'?'}  ·  Score: ${scan.securityScore??'?'}/100`, m, 54);
  doc.text(`Generated: ${new Date().toLocaleString()}`, m, 70);
  y = 100;
  (scan.bugs||[]).forEach((bug,i) => {
    if (y > doc.internal.pageSize.getHeight()-60) { doc.addPage(); y = m; }
    const sc = bug.severity==='HIGH'?[220,38,38]:bug.severity==='MEDIUM'?[217,119,6]:[56,189,248];
    doc.setFillColor(...sc); doc.rect(m,y,4,18,'F');
    doc.setFontSize(11); doc.setFont('helvetica','bold'); doc.setTextColor(30,30,60);
    doc.text(`${i+1}. ${bug.title}`, m+10, y+13);
    doc.setFontSize(8); doc.setTextColor(...sc);
    doc.text(bug.severity, doc.internal.pageSize.getWidth()-m-50, y+13);
    y += 26;
    if (bug.recommendation) {
      doc.setFont('helvetica','normal'); doc.setTextColor(50,50,80);
      doc.splitTextToSize(`Fix: ${bug.recommendation}`, doc.internal.pageSize.getWidth()-m*2-10)
        .forEach(ln => { doc.text(ln, m+10, y); y+=13; });
    }
    y += 8;
  });
  doc.save(`scan_${scan.id?.slice(0,8)||'report'}_${Date.now()}.pdf`);
}

const PAGE_SIZE = 10;

export default function HistoryPage({ onNavigate }) {
  const toast = useToast();
  const location = useLocation();
  const navigate = useNavigate();
  const [history, setHistory]     = useState([]);
  const [loading, setLoading]     = useState(true);
  const [search, setSearch]       = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [gradeFilter, setGradeFilter] = useState('all');
  const [sortBy, setSortBy]       = useState('newest');
  const [page, setPage]           = useState(1);
  const [clearing, setClearing]   = useState(false);
  const [preview, setPreview]     = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try { setHistory(await api.getHistory()); }
    catch { toast?.error('Could not load scan history.'); }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const viewMode = new URLSearchParams(location.search).get('view');
  
  const filterByView = (scan) => {
    if (viewMode === 'completed') return isCompleted(scan);
    if (viewMode === 'review') return needsReview(scan);
    if (viewMode === 'cancelled') return isCancelled(scan);
    return true;
  };

  const filtered = history.filter(h => {
    const matchSearch = !search || (h.target||'').toLowerCase().includes(search.toLowerCase());
    const matchType   = typeFilter === 'all' || h.inputType === typeFilter;
    const matchGrade  = gradeFilter === 'all' || (h.grade||'?')[0] === gradeFilter;
    return matchSearch && matchType && matchGrade && filterByView(h);
  }).sort((a, b) => {
    if (sortBy === 'score') return (b.securityScore || 0) - (a.securityScore || 0);
    if (sortBy === 'issues') return (b.bugsFound || 0) - (a.bugsFound || 0);
    if (sortBy === 'oldest') return new Date(a.createdAt || 0) - new Date(b.createdAt || 0);
    return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
  });
  const totalPages  = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage    = Math.min(page, totalPages);
  const pageItems   = filtered.slice((safePage-1)*PAGE_SIZE, safePage*PAGE_SIZE);
  const avgScore    = history.length
    ? Math.round(history.reduce((sum, scan) => sum + (scan.securityScore || 0), 0) / history.length)
    : 0;
  const completedCount = history.filter(scan => isCompleted(scan)).length;
  const riskCount   = history.filter(scan => needsReview(scan)).length;
  const latestScan  = history[0]?.createdAt ? formatDate(history[0].createdAt) : 'No activity yet';
  const navigateToReport = (scanId) => navigate(`/reports/${scanId}`);

  const handleClear = async () => {
    if (!window.confirm('Delete all scan history? This cannot be undone.')) return;
    setClearing(true);
    try { await api.clearHistory(); setHistory([]); }
    catch { toast?.error('Could not clear scan history.'); }
    setClearing(false);
  };

  const openPreview = async (scan) => {
    setPreviewLoading(true);
    setPreview({ summary: scan, details: null });
    try {
      const details = await api.getHistoryResult(scan.id);
      setPreview({ summary: scan, details });
    } catch {
      setPreview({ summary: scan, details: null, error: 'Could not load report details.' });
      toast?.error('Could not load report details.');
    }
    setPreviewLoading(false);
  };

  return (
    <div className="hist-page animate-fade-up">

      {/* Header */}
      <div className="hist-page-header">
        <div>
          <BackButton label="Back" fallback="/dashboard" />
          <h1 className="hist-page-title">Scan History</h1>
          <p className="hist-page-sub">{history.length} total scans · {filtered.length} matching</p>
        </div>
        <div className="hist-header-actions">
          <button className="hist-action-btn" onClick={load} title="Refresh">
            <RefreshCcw size={14} />
          </button>
          <button className="hist-action-btn hist-action-btn--danger" onClick={handleClear} disabled={clearing || history.length === 0}>
            <Trash2 size={14} /> Clear All
          </button>
          <button className="hist-action-btn hist-action-btn--primary" onClick={() => onNavigate('scan')}>
            <Plus size={14} /> New Scan
          </button>
        </div>
      </div>

      <div className="hist-summary-grid">
        <div className="hist-summary-card" style={{ cursor: 'pointer' }} onClick={() => navigate('/history')}>
          <div className="hist-summary-card__icon hist-summary-card__icon--blue"><ScanLine size={17} /></div>
          <div>
            <span>Total Scans</span>
            <strong>{history.length}</strong>
          </div>
        </div>
        <div className="hist-summary-card" style={{ cursor: 'pointer' }} onClick={() => navigate('/history?view=completed')}>
          <div className="hist-summary-card__icon hist-summary-card__icon--green"><ShieldCheck size={17} /></div>
          <div>
            <span>Completed</span>
            <strong>{completedCount}</strong>
          </div>
        </div>
        <div className="hist-summary-card" style={{ cursor: 'pointer' }} onClick={() => navigate('/history?view=review')}>
          <div className="hist-summary-card__icon hist-summary-card__icon--amber"><AlertTriangle size={17} /></div>
          <div>
            <span>Needs Review</span>
            <strong>{riskCount}</strong>
          </div>
        </div>
        <div className="hist-summary-card">
          <div className="hist-summary-card__icon hist-summary-card__icon--slate"><Calendar size={17} /></div>
          <div>
            <span>Latest Run</span>
            <strong className="hist-summary-card__date">{latestScan}</strong>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="hist-filters glass-card">
        <div className="hist-search">
          <Search size={15} className="hist-search__icon" />
          <input
            className="hist-search__input"
            placeholder="Search by target URL or file name…"
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
          />
          {search && (
            <button className="hist-search__clear" onClick={() => setSearch('')}>✕</button>
          )}
        </div>

        <div className="hist-filter-group">
          <Filter size={14} style={{ color: 'var(--text-muted)', flexShrink:0 }} />
          <select className="hist-select" value={typeFilter} onChange={e => { setTypeFilter(e.target.value); setPage(1); }}>
            <option value="all">All Types</option>
            <option value="codebase">Codebase</option>
            <option value="database">Database</option>
            <option value="both">Full Stack</option>
            <option value="url">URL Scan</option>
          </select>
          <select className="hist-select" value={gradeFilter} onChange={e => { setGradeFilter(e.target.value); setPage(1); }}>
            <option value="all">All Grades</option>
            <option value="A">A</option>
            <option value="B">B</option>
            <option value="C">C</option>
            <option value="D">D</option>
            <option value="F">F</option>
          </select>
          <select className="hist-select" value={sortBy} onChange={e => setSortBy(e.target.value)}>
            <option value="newest">Newest First</option>
            <option value="oldest">Oldest First</option>
            <option value="score">Best Score</option>
            <option value="issues">Most Issues</option>
          </select>
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div className="hist-skeletons">
          {[...Array(5)].map((_,i) => <div key={i} className="hist-skeleton" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="hist-empty glass-card">
          <ShieldCheck size={44} color="var(--text-muted)" />
          <h3>{history.length === 0 ? 'No scans yet' : 'No results match your filters'}</h3>
          <p>{history.length === 0
            ? 'Run your first security scan to see results here.'
            : 'Try adjusting your search or filter criteria.'
          }</p>
          {history.length === 0 && (
            <button className="hist-action-btn hist-action-btn--primary hist-empty__cta" onClick={() => onNavigate('scan')}>
              Start First Scan
            </button>
          )}
        </div>
      ) : (
        <div className="hist-table-wrap glass-card">
          <table className="hist-table">
            <thead>
              <tr>
                <th>Target</th>
                <th>Type</th>
                <th>Grade</th>
                <th>Score</th>
                <th>Issues</th>
                <th>Date</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {pageItems.map(scan => {
                const Icon  = INPUT_ICON[scan.inputType] || Code;
                const label = INPUT_LABEL[scan.inputType] || scan.inputType;
                const gc    = gradeColor(scan.grade);
                const bugs  = scan.bugsFound || 0;
                const bugColor = bugs > 5 ? 'var(--error)' : bugs > 0 ? 'var(--warning)' : 'var(--success)';

                return (
                  <tr key={scan.id} onClick={() => navigateToReport(scan.id)} style={{ cursor: 'pointer' }}>
                    <td>
                      <div className="ht-target">
                        <div className="ht-target__icon">
                          <Icon size={12} />
                        </div>
                        <span title={scan.target}>
                          {(scan.target||'Unknown').length > 30
                            ? '…' + scan.target.slice(-28)
                            : (scan.target||'Unknown')}
                        </span>
                      </div>
                    </td>
                    <td><span className="badge badge--accent">{label}</span></td>
                    <td>
                      <span className="ht-grade" style={{ color: gc }}>
                        {scan.status === 'cancelled' ? 'Cancelled' : scan.grade || '—'}
                      </span>
                    </td>
                    <td>
                      <div className="ht-score-wrap">
                        <div className="ht-score-bar">
                          <div className="ht-score-fill" style={{ width:`${scan.securityScore||0}%`, background: gc }} />
                        </div>
                        <span className="ht-score-num">{scan.securityScore ?? '—'}</span>
                      </div>
                    </td>
                    <td>
                      <span style={{ display:'flex', alignItems:'center', gap:'5px', color: bugColor, fontWeight:700, fontSize:'0.82rem' }}>
                        {bugs > 0 && <Bug size={12} />} {bugs}
                      </span>
                    </td>
                    <td>
                      <div className="ht-date">
                        <Calendar size={11} />
                        {formatDate(scan.createdAt)}
                      </div>
                    </td>
                    <td>
                      <div className="ht-actions">
                        <button
                          className="ht-action-btn"
                          title="Quick Preview"
                          onClick={(e) => { e.stopPropagation(); openPreview(scan); }}
                        >
                          <Eye size={13} />
                        </button>
                        <button
                          className="ht-action-btn"
                          title="Download PDF"
                          onClick={(e) => { e.stopPropagation(); quickExport(scan); }}
                        >
                          <Download size={13} />
                        </button>
                        <button
                          className="ht-action-btn"
                          style={{ color: 'var(--error)' }}
                          title="Delete Scan"
                          onClick={async (e) => {
                            e.stopPropagation();
                            if (window.confirm('Delete this scan? This cannot be undone.')) {
                              try {
                                await api.deleteHistoryResult(scan.id);
                                setHistory(h => h.filter(x => x.id !== scan.id));
                                toast?.success('Scan deleted');
                              } catch {
                                toast?.error('Failed to delete scan');
                              }
                            }
                          }}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="hist-pagination">
              <span className="hist-pagination__info">
                Page {safePage} of {totalPages} · {filtered.length} results
              </span>
              <div className="hist-pagination__btns">
                <button
                  className="hist-pg-btn"
                  onClick={() => setPage(p => Math.max(1, p-1))}
                  disabled={safePage === 1}
                >
                  <ChevronLeft size={15} />
                </button>
                {[...Array(totalPages)].map((_,i) => (
                  <button
                    key={i}
                    className={`hist-pg-btn ${safePage===i+1 ? 'hist-pg-btn--active' : ''}`}
                    onClick={() => setPage(i+1)}
                  >
                    {i+1}
                  </button>
                ))}
                <button
                  className="hist-pg-btn"
                  onClick={() => setPage(p => Math.min(totalPages, p+1))}
                  disabled={safePage === totalPages}
                >
                  <ChevronRight size={15} />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {preview && (
        <div className="hist-modal-backdrop" onClick={() => setPreview(null)}>
          <div className="hist-preview-modal glass-card" onClick={e => e.stopPropagation()}>
            <div className="hist-preview-modal__head">
              <div className="hist-preview-modal__head-main">
                <BackButton
                  label="Back to History"
                  fallback="/history"
                  onClick={() => setPreview(null)}
                  className="hist-preview-back"
                />
                <h3>Report Preview</h3>
                <p>{preview.summary.target}</p>
              </div>
              <button
                type="button"
                className="hist-preview-close"
                aria-label="Close preview"
                onClick={() => setPreview(null)}
              >
                ×
              </button>
            </div>
            {previewLoading ? (
              <div className="hist-skeleton" />
            ) : preview.error ? (
              <div className="hist-empty hist-empty--compact">{preview.error}</div>
            ) : (
              <>
                <div className="hist-preview-stats">
                  <div><span>Grade</span><strong style={{ color: gradeColor(preview.summary.grade) }}>{preview.summary.grade || '-'}</strong></div>
                  <div><span>Score</span><strong>{preview.summary.securityScore ?? '-'}</strong></div>
                  <div><span>Issues</span><strong>{preview.summary.bugsFound ?? 0}</strong></div>
                </div>
                <div className="hist-preview-list">
                  {(preview.details?.bugs || []).slice(0, 4).map((bug, idx) => (
                    <div key={bug.id || idx} className="hist-preview-issue">
                      <span className={`hist-preview-sev hist-preview-sev--${(bug.severity || '').toLowerCase()}`}>{bug.severity}</span>
                      <strong>{bug.title}</strong>
                      <p>{bug.recommendation}</p>
                    </div>
                  ))}
                  {(preview.details?.bugs || []).length === 0 && <p className="hist-preview-none">No issues in this report.</p>}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ActivityIcon() {
  return <span className="hist-activity-dot" />;
}
