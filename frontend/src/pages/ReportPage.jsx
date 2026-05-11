import React, { useState, useEffect } from 'react';
import {
  ShieldCheck, Download, RefreshCcw, ChevronDown, ChevronUp,
  AlertTriangle, XCircle, Info, AlertCircle, Lightbulb,
  CheckCircle, Target, FileText, Calendar, Globe, Code,
  Database, Layers
} from 'lucide-react';
import { jsPDF } from 'jspdf';
import BackButton from '../components/BackButton';
import { useToast } from '../context/ToastContext';
import api from '../services/api';
import '../styles/reportPage.css';

// ── Config ──────────────────────────────────────────────────────────────────
const SEV_CFG = {
  CRITICAL: { color: '#dc2626', bg: 'rgba(220,38,38,0.1)',   border: 'rgba(220,38,38,0.3)',  icon: AlertCircle  },
  HIGH:     { color: '#ef4444', bg: 'rgba(239,68,68,0.1)',   border: 'rgba(239,68,68,0.3)',  icon: XCircle      },
  MEDIUM:   { color: '#f59e0b', bg: 'rgba(245,158,11,0.1)',  border: 'rgba(245,158,11,0.3)', icon: AlertTriangle},
  LOW:      { color: '#38bdf8', bg: 'rgba(56,189,248,0.1)',  border: 'rgba(56,189,248,0.25)',icon: Info         },
};

const INPUT_ICON  = { codebase: Code, database: Database, both: Layers, url: Globe };
const INPUT_LABEL = { codebase: 'Codebase', database: 'Database', both: 'Full Stack', url: 'URL Scan' };

const gradeColor = g => {
  if (!g) return 'var(--text-muted)';
  const l = g[0];
  if (l === 'A') return 'var(--success)';
  if (l === 'B') return 'var(--info)';
  if (l === 'C') return 'var(--warning)';
  return 'var(--error)';
};

// ── SVG Score Arc ────────────────────────────────────────────────────────────
function ScoreArc({ score = 0, color }) {
  const R = 52, C = 2 * Math.PI * R;
  const filled = (score / 100) * C;
  return (
    <svg width="130" height="130" viewBox="0 0 130 130">
      <circle cx="65" cy="65" r={R} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="10" />
      <circle
        cx="65" cy="65" r={R}
        fill="none"
        stroke={color}
        strokeWidth="10"
        strokeDasharray={`${filled} ${C}`}
        strokeLinecap="round"
        transform="rotate(-90 65 65)"
        style={{ filter: `drop-shadow(0 0 8px ${color})` }}
      />
      <text x="65" y="60" textAnchor="middle" fill={color} fontSize="22" fontWeight="900" fontFamily="Inter,sans-serif">{score}</text>
      <text x="65" y="78" textAnchor="middle" fill="rgba(255,255,255,0.35)" fontSize="11" fontFamily="Inter,sans-serif">/100</text>
    </svg>
  );
}

// ── Donut Chart (pure CSS conic-gradient) ─────────────────────────────────
function DonutChart({ bugs = [] }) {
  const total = bugs.length;
  if (total === 0) return (
    <div className="donut-empty">
      <ShieldCheck size={32} color="var(--success)" />
      <span>No issues</span>
    </div>
  );
  const counts = { CRITICAL:0, HIGH:0, MEDIUM:0, LOW:0 };
  bugs.forEach(b => { if (counts[b.severity] !== undefined) counts[b.severity]++; });
  const colors = { CRITICAL:'#dc2626', HIGH:'#ef4444', MEDIUM:'#f59e0b', LOW:'#38bdf8' };
  let cum = 0;
  const stops = Object.entries(counts).filter(([,n])=>n>0).map(([sev, n]) => {
    const pct = (n / total) * 100;
    const stop = `${colors[sev]} ${cum}% ${cum + pct}%`;
    cum += pct;
    return stop;
  }).join(', ');
  return (
    <div className="donut-wrap">
      <div className="donut" style={{ background: `conic-gradient(${stops})` }}>
        <div className="donut-hole">
          <span className="donut-total">{total}</span>
          <span className="donut-label">issues</span>
        </div>
      </div>
      <div className="donut-legend">
        {Object.entries(counts).filter(([,n])=>n>0).map(([sev,n])=>(
          <div key={sev} className="donut-legend__item">
            <span className="donut-legend__dot" style={{ background: colors[sev] }} />
            <span className="donut-legend__sev">{sev}</span>
            <span className="donut-legend__n">{n}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── PDF Export ───────────────────────────────────────────────────────────────
function exportPDF(report) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
  const m = 44; let y = m;
  const check = (n=60) => { if (y+n > H-m) { doc.addPage(); y = m; } };

  // Header
  doc.setFillColor(12,12,28); doc.rect(0,0,W,90,'F');
  doc.setFillColor(99,102,241); doc.rect(0,0,5,90,'F');
  doc.setFontSize(22); doc.setFont('helvetica','bold'); doc.setTextColor(255,255,255);
  doc.text('TestOps AI Security Report', m, 36);
  doc.setFontSize(10); doc.setFont('helvetica','normal'); doc.setTextColor(160,160,200);
  doc.text(`Generated: ${new Date().toLocaleString()}`, m, 55);
  doc.text(`Target: ${report.target||'N/A'}  ·  Type: ${report.inputType||'N/A'}`, m, 72);
  y = 110;

  // Summary table
  doc.setFillColor(245,245,255); doc.roundedRect(m, y, W-m*2, 80, 4,4,'F');
  doc.setFontSize(12); doc.setFont('helvetica','bold'); doc.setTextColor(30,30,60);
  doc.text('Audit Summary', m+12, y+18);
  const rows = [
    [`Grade: ${report.grade||'—'}`, `Score: ${report.securityScore||0}/100`],
    [`Total Issues: ${report.bugsFound||0}`, `High: ${(report.bugs||[]).filter(b=>b.severity==='HIGH').length}`],
    [`Medium: ${(report.bugs||[]).filter(b=>b.severity==='MEDIUM').length}`, `Low: ${(report.bugs||[]).filter(b=>b.severity==='LOW').length}`],
  ];
  doc.setFontSize(10); doc.setFont('helvetica','normal');
  rows.forEach(([l,r],i) => {
    doc.setTextColor(50,50,80);
    doc.text(l, m+12, y+34+i*16);
    doc.text(r, m+200, y+34+i*16);
  });
  y += 96;

  // Issues
  check(30);
  doc.setFontSize(14); doc.setFont('helvetica','bold'); doc.setTextColor(30,30,60);
  doc.text('Identified Issues', m, y); y += 20;

  (report.bugs||[]).forEach((bug, i) => {
    check(90);
    const sc = bug.severity==='CRITICAL'?[185,28,28]:bug.severity==='HIGH'?[220,38,38]:bug.severity==='MEDIUM'?[217,119,6]:[56,189,248];
    doc.setFillColor(...sc); doc.rect(m, y, 4, 20,'F');
    doc.setFontSize(11); doc.setFont('helvetica','bold'); doc.setTextColor(30,30,60);
    doc.text(`${i+1}. ${bug.title}`, m+10, y+14);
    doc.setFontSize(8); doc.setTextColor(...sc);
    doc.text(bug.severity, W-m-50, y+14);
    y += 24;
    [['Root Cause', bug.reason], ['Fix', bug.recommendation]].forEach(([lbl,val])=>{
      check(36);
      doc.setFont('helvetica','bold'); doc.setFontSize(8); doc.setTextColor(100,100,140);
      doc.text(lbl.toUpperCase(), m+10, y); y+=12;
      doc.setFont('helvetica','normal'); doc.setTextColor(50,50,80);
      doc.splitTextToSize(val||'', W-m*2-10).forEach(ln=>{ check(14); doc.text(ln,m+10,y); y+=13; });
      y+=4;
    });
    y+=10;
  });
  doc.save(`testops_report_${Date.now()}.pdf`);
}

// ── Main Component ───────────────────────────────────────────────────────────
export default function ReportPage({ onNavigate }) {
  const toast = useToast();
  const [history, setHistory]   = useState([]);
  const [selected, setSelected] = useState(null); // full report object
  const [loading, setLoading]   = useState(true);
  const [loadingReport, setLoadingReport] = useState(false);
  const [expanded, setExpanded] = useState(null);

  useEffect(() => {
    api.getHistory()
      .then(h => setHistory(h))
      .catch(() => toast?.error('Could not load reports.'))
      .finally(() => setLoading(false));
  }, [toast]);

  const loadReport = async (id) => {
    setLoadingReport(true);
    try {
      const data = await api.getHistoryResult(id);
      const next = { ...data, id };
      setSelected(next);
      try {
        // Lightweight "current report" context for the chat assistant (no architecture/UI changes)
        const ctx = {
          id,
          grade: next.grade,
          securityScore: next.securityScore,
          bugsFound: next.bugsFound,
          bugs: (next.bugs || []).map(b => ({
            id: b.id,
            severity: b.severity,
            title: b.title,
            type: b.type,
            reason: b.reason,
            reproduction: b.reproduction,
            recommendation: b.recommendation,
          })),
        };
        localStorage.setItem('testops_current_report', JSON.stringify(ctx));
      } catch { /* ignore storage issues */ }
    } catch {
      toast?.error('Could not load report details.');
    }
    setLoadingReport(false);
  };

  const scoreColor = s => s >= 80 ? 'var(--success)' : s >= 60 ? 'var(--warning)' : 'var(--error)';

  // ── Report detail view ──
  if (selected) {
    const bugs   = selected.bugs || [];
    const gc     = gradeColor(selected.grade);
    const sc     = scoreColor(selected.securityScore || 0);
    const sorted = [...bugs].sort((a,b) => {
      const o = {CRITICAL:0,HIGH:1,MEDIUM:2,LOW:3};
      return (o[a.severity]??4)-(o[b.severity]??4);
    });

    return (
      <div className="rp-page animate-fade-up">
        {/* Back bar */}
        <div className="rp-back-bar">
          <BackButton label="Back to Reports" fallback="/reports" onClick={() => { setSelected(null); setExpanded(null); }} />
          <div className="rp-back-bar__actions">
            <button className="rp-action-btn" onClick={() => exportPDF(selected)}>
              <Download size={14} /> Export PDF
            </button>
            <button className="rp-action-btn rp-action-btn--primary" onClick={() => onNavigate('scan')}>
              <RefreshCcw size={14} /> New Scan
            </button>
          </div>
        </div>

        {/* ── Overview row ── */}
        <div className="rp-overview">

          {/* Score arc */}
          <div className="rp-overview-card rp-overview-card--score glass-card">
            <div className="rp-oc__label">Security Score</div>
            <ScoreArc score={selected.securityScore || 0} color={sc} />
            <div className="rp-grade-badge" style={{ color: gc, borderColor: gc, background: `${gc}18` }}>
              Grade {selected.grade || '?'}
            </div>
          </div>

          {/* Donut chart */}
          <div className="rp-overview-card rp-overview-card--donut glass-card">
            <div className="rp-oc__label">Issue Distribution</div>
            <DonutChart bugs={bugs} />
          </div>

          {/* Severity breakdown bars */}
          <div className="rp-overview-card rp-overview-card--bars glass-card">
            <div className="rp-oc__label">Severity Breakdown</div>
            <div className="rp-sev-bars">
              {['CRITICAL','HIGH','MEDIUM','LOW'].map(sev => {
                const count = bugs.filter(b=>b.severity===sev).length;
                const cfg = SEV_CFG[sev];
                return (
                  <div key={sev} className="rp-sev-row">
                    <span className="rp-sev-badge" style={{ color:cfg.color, background:cfg.bg, borderColor:cfg.border }}>
                      {sev}
                    </span>
                    <div className="rp-sev-track">
                      <div className="rp-sev-fill" style={{ width: bugs.length>0?`${(count/bugs.length)*100}%`:'0%', background:cfg.color }} />
                    </div>
                    <span className="rp-sev-count" style={{ color:cfg.color }}>{count}</span>
                  </div>
                );
              })}
            </div>

            {/* Meta info */}
            <div className="rp-meta">
              <div className="rp-meta-item">
                <Calendar size={13} />
                {new Date(selected.createdAt || Date.now()).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'})}
              </div>
              {selected.target && (
                <div className="rp-meta-item">
                  {React.createElement(INPUT_ICON[selected.inputType] || Code, { size: 13 })}
                  <span title={selected.target}>
                    {selected.target.length > 30 ? '…'+selected.target.slice(-28) : selected.target}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── AI Analysis banner ── */}
        <div className="rp-ai-banner glass-card">
          <div className="rp-ai-banner__icon">
            <Lightbulb size={18} color="#818cf8" />
          </div>
          <div className="rp-ai-banner__body">
            <div className="rp-ai-banner__title">AI Security Assessment</div>
            <div className="rp-ai-banner__text">
              {bugs.length === 0
                ? 'No vulnerabilities detected. The target passed all selected security checks.'
                : `Detected ${bugs.length} issue${bugs.length>1?'s':''} — ${bugs.filter(b=>['HIGH','CRITICAL'].includes(b.severity)).length} require immediate attention. Score: ${selected.securityScore}/100 (${selected.grade}).`
              }
              {selected.securityScore >= 90 && ' Excellent security posture.'}
              {selected.securityScore >= 70 && selected.securityScore < 90 && ' Good posture with minor gaps.'}
              {selected.securityScore >= 50 && selected.securityScore < 70 && ' Moderate risk — remediation recommended.'}
              {selected.securityScore < 50 && ' Critical risk — immediate action required.'}
            </div>
          </div>
          <div className="rp-ai-banner__model badge badge--accent">llama-3.3-70b · Groq</div>
        </div>

        {/* ── Vulnerability list ── */}
        <div className="rp-vuln-section">
          <h2 className="rp-section-title">
            <AlertTriangle size={16} />
            Vulnerabilities ({bugs.length})
          </h2>

          {bugs.length === 0 ? (
            <div className="rp-empty glass-card">
              <ShieldCheck size={44} color="var(--success)" />
              <h3>All Clear</h3>
              <p>No vulnerabilities found in this scan.</p>
            </div>
          ) : (
            <div className="rp-vuln-list">
              {sorted.map((bug, idx) => {
                const cfg  = SEV_CFG[bug.severity] || SEV_CFG.LOW;
                const Icon = cfg.icon;
                const key  = bug.id || idx;
                const open = expanded === key;
                return (
                  <div
                    key={key}
                    className={`rp-vuln-card glass-card ${open ? 'rp-vuln-card--open' : ''}`}
                    style={{ '--vc': cfg.color, '--vbr': cfg.border, '--vbg': cfg.bg }}
                  >
                    <button className="rp-vuln-head" onClick={() => setExpanded(open ? null : key)}>
                      <div className="rp-vuln-left">
                        <div className="rp-vuln-bar" />
                        <div className="rp-vuln-icon"><Icon size={15} style={{ color: cfg.color }} /></div>
                        <div className="rp-vuln-meta">
                          <span className="rp-vuln-title">{bug.title}</span>
                          <div className="rp-vuln-tags">
                            <span className="badge" style={{ background:cfg.bg, color:cfg.color, border:`1px solid ${cfg.border}` }}>
                              {bug.severity}
                            </span>
                            {bug.type && <span className="badge badge--accent">{bug.type}</span>}
                          </div>
                        </div>
                      </div>
                      <span className="rp-vuln-chevron">
                        {open ? <ChevronUp size={15}/> : <ChevronDown size={15}/>}
                      </span>
                    </button>

                    {open && (
                      <div className="rp-vuln-detail">
                        <div className="rp-detail-grid">
                          <div className="rp-detail-block">
                            <div className="rp-detail-head"><Target size={13}/>Root Cause</div>
                            <p className="rp-detail-text">{bug.reason || '—'}</p>
                          </div>
                          <div className="rp-detail-block">
                            <div className="rp-detail-head"><FileText size={13}/>Reproduction</div>
                            <pre className="rp-detail-code">{bug.reproduction || '—'}</pre>
                          </div>
                          <div className="rp-detail-block rp-detail-block--fix">
                            <div className="rp-detail-head"><CheckCircle size={13} color="var(--success)"/>Recommended Fix</div>
                            <div className="rp-detail-fix">{bug.recommendation || '—'}</div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Report list view ──
  return (
    <div className="rp-page animate-fade-up">
      <div className="rp-list-header">
        <div>
          <BackButton label="Back" fallback="/dashboard" />
          <h1 className="rp-list-title">Reports</h1>
          <p className="rp-list-sub">Click any report to view the full AI security analysis with charts.</p>
        </div>
        <button className="rp-action-btn rp-action-btn--primary" onClick={() => onNavigate('scan')}>
          + New Scan
        </button>
      </div>

      {loading && (
        <div className="rp-skeletons">
          {[...Array(4)].map((_,i) => <div key={i} className="rp-skeleton" />)}
        </div>
      )}

      {!loading && history.length === 0 && (
        <div className="rp-empty glass-card">
          <ShieldCheck size={44} color="var(--text-muted)" />
          <h3>No Reports Yet</h3>
          <p>Complete a scan to generate your first security report.</p>
          <button className="rp-action-btn rp-action-btn--primary" onClick={() => onNavigate('scan')}>
            Start First Scan
          </button>
        </div>
      )}

      {!loading && history.length > 0 && (
        <div className="rp-report-grid">
          {history.map(h => {
            const gc = gradeColor(h.grade);
            const Icon = INPUT_ICON[h.inputType] || Code;
            const label = INPUT_LABEL[h.inputType] || h.inputType;
            return (
              <button key={h.id} className="rp-report-card glass-card" onClick={() => loadReport(h.id)}>
                <div className="rp-rc__top">
                  <div className="rp-rc__grade" style={{ color:gc, borderColor:gc, background:`${gc}18` }}>
                    {h.grade || '?'}
                  </div>
                  <div className="rp-rc__score" style={{ color:gc }}>
                    {h.securityScore ?? '—'}<span style={{fontSize:'0.7rem',color:'var(--text-muted)'}}>/100</span>
                  </div>
                </div>
                <div className="rp-rc__target" title={h.target}>
                  <Icon size={13} style={{ flexShrink:0 }} />
                  <span>{h.target?.length > 32 ? '…'+h.target.slice(-30) : (h.target||'Unknown')}</span>
                </div>
                <div className="rp-rc__footer">
                  <span className="badge badge--accent">{label}</span>
                  <span className="rp-rc__bugs" style={{ color: (h.bugsFound||0)>5?'var(--error)':(h.bugsFound||0)>0?'var(--warning)':'var(--success)' }}>
                    {h.bugsFound||0} issues
                  </span>
                </div>
                <div className="rp-rc__date">
                  <Calendar size={11}/>{new Date(h.createdAt||Date.now()).toLocaleDateString('en-GB',{day:'2-digit',month:'short'})}
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
