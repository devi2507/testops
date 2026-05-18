import React, { useEffect, useMemo, useState } from 'react';
import {
  ShieldAlert, RefreshCcw, CheckCircle, AlertTriangle,
  XCircle, Info, ChevronDown, ChevronUp, Download,
  Bug, ShieldCheck, Link,
  FileText, Lightbulb, Target, AlertCircle
} from 'lucide-react';
import { jsPDF } from 'jspdf';
import BackButton from './BackButton';
import './ResultsDashboard.css';

// ─── Severity config ────────────────────────────────────────────────────────
const SEV = {
  HIGH:     { icon: XCircle,       color: 'var(--error)',    bg: 'rgba(239,68,68,0.1)',     border: 'rgba(239,68,68,0.3)',    label: 'HIGH'     },
  MEDIUM:   { icon: AlertTriangle, color: 'var(--warning)',  bg: 'rgba(245,158,11,0.1)',    border: 'rgba(245,158,11,0.3)',   label: 'MEDIUM'   },
  LOW:      { icon: Info,          color: 'var(--info)',     bg: 'rgba(56,189,248,0.1)',    border: 'rgba(56,189,248,0.25)', label: 'LOW'      },
  CRITICAL: { icon: AlertCircle,   color: 'var(--critical)', bg: 'rgba(220,38,38,0.1)',     border: 'rgba(220,38,38,0.3)',    label: 'CRITICAL' },
};

const gradeColor = (g) => {
  if (!g) return 'var(--text-muted)';
  const l = g[0];
  if (l === 'A') return 'var(--success)';
  if (l === 'B') return 'var(--info)';
  if (l === 'C') return 'var(--warning)';
  return 'var(--error)';
};

const scoreColor = (s) => s >= 80 ? 'var(--success)' : s >= 60 ? 'var(--warning)' : 'var(--error)';
const SEVERITY_FILTERS = ['ALL', 'CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];

function extractFixSnippet(text = '') {
  const fenced = text.match(/```(?:\w+)?\s*([\s\S]*?)```/);
  if (fenced?.[1]?.trim()) return fenced[1].trim();
  return '';
}

// ─── PDF Export ─────────────────────────────────────────────────────────────
function exportPDF(results) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const margin = 44;
  let y = margin;

  const addPage = () => { doc.addPage(); y = margin; };
  const check = (n = 60) => { if (y + n > H - margin) addPage(); };

  // Header band
  doc.setFillColor(12, 12, 28);
  doc.rect(0, 0, W, 88, 'F');
  doc.setFillColor(99, 102, 241);
  doc.rect(0, 0, 5, 88, 'F');
  doc.setFontSize(24); doc.setFont('helvetica', 'bold'); doc.setTextColor(255,255,255);
  doc.text('TestPilot AI Executive Report', margin, 38);
  doc.setFontSize(10); doc.setFont('helvetica', 'normal'); doc.setTextColor(160,160,200);
  doc.text(`AI-Powered Audit  ·  Generated ${new Date().toLocaleString()}`, margin, 58);
  doc.text(`Report ID: ${Date.now()}`, margin, 74);
  y = 108;

  // Summary box
  doc.setFillColor(245,245,255);
  doc.roundedRect(margin, y, W - margin*2, 90, 4, 4, 'F');
  doc.setFontSize(13); doc.setFont('helvetica', 'bold'); doc.setTextColor(30,30,60);
  doc.text('Audit Summary', margin+14, y+20);
  doc.setFontSize(10); doc.setFont('helvetica', 'normal');
  const cols = [
    [`Grade: ${results.grade||'—'}`, `Score: ${results.securityScore}/100`],
    [`Total Issues: ${results.bugsFound}`, `HIGH: ${results.bugs?.filter(b=>b.severity==='HIGH').length||0}`],
    [`MEDIUM: ${results.bugs?.filter(b=>b.severity==='MEDIUM').length||0}`, `LOW: ${results.bugs?.filter(b=>b.severity==='LOW').length||0}`],
  ];
  cols.forEach(([l, r], i) => {
    doc.setTextColor(50,50,80);
    doc.text(l, margin+14, y+40+i*16);
    doc.text(r, margin+200, y+40+i*16);
  });
  y += 106;

  // Issues
  doc.setFontSize(15); doc.setFont('helvetica', 'bold'); doc.setTextColor(30,30,60);
  check(30); doc.text('Identified Issues', margin, y); y += 22;

  results.bugs?.forEach((bug, i) => {
    check(100);
    const sc = bug.severity==='HIGH'?[220,38,38]:bug.severity==='MEDIUM'?[217,119,6]:bug.severity==='CRITICAL'?[185,28,28]:[56,189,248];
    doc.setFillColor(...sc); doc.rect(margin, y, 4, 20, 'F');
    doc.setFontSize(11); doc.setFont('helvetica', 'bold'); doc.setTextColor(30,30,60);
    doc.text(`${i+1}. ${bug.title}`, margin+12, y+14);
    doc.setFontSize(8); doc.setTextColor(...sc);
    doc.text(bug.severity, W-margin-50, y+14);
    y += 26;
    [['Root Cause', bug.reason], ['Reproduction', bug.reproduction], ['Fix', bug.recommendation]].forEach(([lbl, val]) => {
      check(40);
      doc.setFont('helvetica','bold'); doc.setFontSize(8); doc.setTextColor(100,100,140);
      doc.text(lbl.toUpperCase(), margin+12, y); y+=12;
      doc.setFont('helvetica','normal'); doc.setTextColor(50,50,80);
      doc.splitTextToSize(val||'',W-margin*2-12).forEach(ln=>{ check(14); doc.text(ln,margin+12,y); y+=13; });
      y+=5;
    });
    y += 10;
  });

  doc.save(`testops_audit_${Date.now()}.pdf`);
}

// ─── Component ──────────────────────────────────────────────────────────────
export default function ResultsDashboard({ results, testId, onReset, backTo = '/scan', backLabel = 'Back' }) {
  const [expanded, setExpanded] = useState(null);
  const [copied, setCopied]     = useState(false);
  const [activeSection, setActiveSection] = useState('vulnerabilities');
  const [severityFilter, setSeverityFilter] = useState('ALL');
  const [vulnSearch, setVulnSearch] = useState('');
  const [expandedFixes, setExpandedFixes] = useState({});

  if (!results) return null;

  const bugs       = results.bugs || [];
  const highCount  = bugs.filter(b => b.severity === 'HIGH').length;
  const medCount   = bugs.filter(b => b.severity === 'MEDIUM').length;
  const lowCount   = bugs.filter(b => b.severity === 'LOW').length;
  const critCount  = bugs.filter(b => b.severity === 'CRITICAL').length;
  const total      = bugs.length;
  const noBugs     = total === 0;
  const gc         = gradeColor(results.grade);
  const sc         = scoreColor(results.securityScore);

  const breakdown = useMemo(() => {
    const severityPenalty = highCount * 15 + medCount * 7 + lowCount * 3 + critCount * 20;
    return [
      { label: 'Security', value: Math.max(0, 100 - severityPenalty), color: 'var(--error)' },
      { label: 'Stability', value: Math.max(0, 96 - medCount * 6 - highCount * 10), color: 'var(--info)' },
      { label: 'Maintainability', value: Math.max(0, 94 - lowCount * 5 - medCount * 4), color: 'var(--accent)' },
      { label: 'Performance', value: Math.max(0, 92 - bugs.filter(b => (b.type || '').toLowerCase().includes('performance')).length * 12), color: 'var(--warning)' },
    ];
  }, [bugs, critCount, highCount, lowCount, medCount]);

  useEffect(() => {
    // store current report in localStorage so AI assistant can access it for context
    try {
      localStorage.setItem('testops_current_report', JSON.stringify({
        id:            testId,
        securityScore: results.securityScore,
        score:         results.securityScore, // keep both for compatibility
        grade:         results.grade,
        bugsFound:     results.bugsFound,
        target:        results.target || '',
        bugs: bugs.map(b => ({
          title:          b.title,
          severity:       b.severity,
          type:           b.type,
          reason:         b.reason,
          recommendation: b.recommendation,
        })),
      }));
    } catch {}
  }, [bugs, results.securityScore, results.grade, results.bugsFound, results.target, testId]);

  const visibleBugs = useMemo(() => {
    const q = vulnSearch.trim().toLowerCase();
    return [...bugs]
      .filter(b => severityFilter === 'ALL' || (b.severity || '').toUpperCase() === severityFilter)
      .filter(b => {
        if (!q) return true;
        const haystack = `${b.title || ''} ${b.type || ''} ${b.reason || ''} ${b.recommendation || ''}`.toLowerCase();
        return haystack.includes(q);
      })
      .sort((a, b) => {
        const order = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
        return (order[a.severity] ?? 4) - (order[b.severity] ?? 4);
      });
  }, [bugs, severityFilter, vulnSearch]);

  const copyLink = () => {
    const url = `${window.location.origin}/reports/${testId}`;
    navigator.clipboard.writeText(url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  };

  return (
    <div className="report-page animate-fade-up">
      <BackButton label={backLabel} fallback={backTo} />

      {/* ══ HERO HEADER ════════════════════════════════════════════════════ */}
      <div className="report-hero glass-card">
        <div className="report-hero__left">
          <div className="report-grade-ring" style={{ '--gc': gc }}>
            <span className="report-grade-ring__letter" style={{ color: gc }}>
              {results.grade || '?'}
            </span>
          </div>
          <div>
            <h1 className="report-hero__title">Security Audit Report</h1>
            <p className="report-hero__sub">AI-powered analysis · {new Date().toLocaleDateString()}</p>
            <div className="report-hero__badges">
              <span className="badge badge--accent">TestOps Platform</span>
              {noBugs && <span className="badge badge--success">✓ All Clear</span>}
              {highCount > 0 && <span className="badge badge--error">{highCount} High Severity</span>}
            </div>
          </div>
        </div>

        <div className="report-hero__actions">
          {testId && (
            <button className={`rpt-btn rpt-btn--ghost ${copied ? 'rpt-btn--copied' : ''}`} onClick={copyLink}>
              <Link size={14} />
              {copied ? 'Copied!' : 'Share'}
            </button>
          )}
          <button className="rpt-btn rpt-btn--ghost" onClick={() => exportPDF(results)}>
            <Download size={14} /> Export PDF
          </button>
          <button className="rpt-btn rpt-btn--primary" onClick={onReset}>
            <RefreshCcw size={14} /> New Scan
          </button>
        </div>
      </div>

      {/* ══ STATS ROW ══════════════════════════════════════════════════════ */}
      <div className="report-stats">

        {/* Score card */}
        <div className="rstat-card glass-card">
          <div className="rstat-card__label">Security Score</div>
          <div className="rstat-card__value" style={{ color: sc }}>{results.securityScore}<span style={{fontSize:'1rem',color:'var(--text-muted)'}}>/100</span></div>
          <div className="rstat-score-bar">
            <div className="rstat-score-bar__fill" style={{ width:`${results.securityScore}%`, background: sc }} />
          </div>
        </div>

        {/* Total issues */}
        <div className="rstat-card glass-card">
          <div className="rstat-card__label">Total Issues</div>
          <div className="rstat-card__value" style={{ color: noBugs ? 'var(--success)' : 'var(--error)' }}>
            {noBugs ? <ShieldCheck size={32} /> : total}
          </div>
          <div className="rstat-card__sub">{noBugs ? 'No vulnerabilities found' : 'vulnerabilities detected'}</div>
        </div>

        {/* Severity breakdown */}
        <div className="rstat-card rstat-card--wide glass-card">
          <div className="rstat-card__label">Severity Breakdown</div>
          <div className="sev-bars">
            {[
              { label:'Critical', count: critCount, color: 'var(--critical)' },
              { label:'High',     count: highCount, color: 'var(--error)' },
              { label:'Medium',   count: medCount,  color: 'var(--warning)' },
              { label:'Low',      count: lowCount,  color: 'var(--info)' },
            ].map(({ label, count, color }) => (
              <div key={label} className="sev-bar-row">
                <span className="sev-bar-row__label">{label}</span>
                <div className="sev-bar-row__track">
                  <div
                    className="sev-bar-row__fill"
                    style={{ width: total > 0 ? `${(count/total)*100}%` : '0%', background: color }}
                  />
                </div>
                <span className="sev-bar-row__count" style={{ color }}>{count}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="score-intel glass-card">
        <div className="score-ring" style={{ '--score': results.securityScore, '--score-color': sc }}>
          <span>{results.securityScore}</span>
          <small>/100</small>
        </div>
        <div className="score-intel__body">
          <div className="score-intel__head">
            <div>
              <h3>AI Security Score</h3>
              <p>Weighted across security, stability, maintainability, and performance signals.</p>
            </div>
          </div>
          <div className="score-breakdown">
            {breakdown.map(item => (
              <div key={item.label} className="score-breakdown__row">
                <span>{item.label}</span>
                <div className="score-breakdown__track">
                  <div style={{ width: `${item.value}%`, background: item.color }} />
                </div>
                <strong>{item.value}</strong>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ══ SECTION TABS ═══════════════════════════════════════════════════ */}
      <div className="report-tabs">
        <button
          className={`report-tab ${activeSection==='vulnerabilities' ? 'report-tab--active' : ''}`}
          onClick={() => setActiveSection('vulnerabilities')}
        >
          <Bug size={15} /> Vulnerabilities ({total})
        </button>
        <button
          className={`report-tab ${activeSection==='analysis' ? 'report-tab--active' : ''}`}
          onClick={() => setActiveSection('analysis')}
        >
          <Lightbulb size={15} /> AI Analysis
        </button>
      </div>

      {/* ══ VULNERABILITIES TAB ════════════════════════════════════════════ */}
      {activeSection === 'vulnerabilities' && (
        <div className="report-section">
          <div className="report-vuln-controls glass-card">
            <div className="report-vuln-controls__filters">
              {SEVERITY_FILTERS.map(filter => (
                <button
                  key={filter}
                  className={`report-vuln-filter ${severityFilter === filter ? 'report-vuln-filter--active' : ''}`}
                  onClick={() => setSeverityFilter(filter)}
                >
                  {filter}
                </button>
              ))}
            </div>
            <input
              className="report-vuln-search"
              placeholder="Search vulnerabilities..."
              value={vulnSearch}
              onChange={e => setVulnSearch(e.target.value)}
            />
          </div>

          {noBugs ? (
            <div className="report-empty glass-card">
              <ShieldCheck size={52} color="var(--success)" />
              <h2>No Vulnerabilities Found</h2>
              <p>The AI analysis found no issues within the selected test scope. Your target looks clean for these categories.</p>
              <p style={{ fontSize:'0.78rem', color:'var(--text-muted)', marginTop:'8px' }}>
                Try running with additional test suites for broader coverage.
              </p>
            </div>
          ) : (
            <div className="vuln-list">
              {visibleBugs.length === 0 && (
                <div className="report-empty glass-card">
                  <ShieldAlert size={42} color="var(--text-muted)" />
                  <h2>No matching vulnerabilities</h2>
                  <p>Try a different search term or switch severity filter to view more findings.</p>
                  <button className="rpt-btn rpt-btn--ghost" onClick={() => { setSeverityFilter('ALL'); setVulnSearch(''); }}>
                    Clear Filters
                  </button>
                </div>
              )}
              {visibleBugs.map((bug, idx) => {
                  const cfg = SEV[bug.severity] || SEV.LOW;
                  const Icon = cfg.icon;
                  const key  = bug.id || idx;
                  const open = expanded === key;
                  const fixSnippet = extractFixSnippet(bug.recommendation || '');
                  const fixOpen = Boolean(expandedFixes[key]);

                  return (
                    <div
                      key={key}
                      className={`vuln-card glass-card ${open ? 'vuln-card--open' : ''}`}
                      style={{ '--vc': cfg.color, '--vb': cfg.bg, '--vbr': cfg.border }}
                    >
                      {/* Header row */}
                      <button className="vuln-card__head" onClick={() => setExpanded(open ? null : key)}>
                        <div className="vuln-card__left">
                          <div className="vuln-card__sev-bar" />
                          <div className="vuln-card__icon-wrap">
                            <Icon size={16} style={{ color: cfg.color }} />
                          </div>
                          <div className="vuln-card__meta">
                            <span className="vuln-card__title">{bug.title}</span>
                            <div className="vuln-card__tags">
                              <span className="badge" style={{ background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.border}` }}>
                                {cfg.label}
                              </span>
                              {bug.type && <span className="badge badge--accent">{bug.type}</span>}
                            </div>
                          </div>
                        </div>
                        <div className="vuln-card__toggle">
                          {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                        </div>
                      </button>

                      {/* Expandable detail */}
                      {open && (
                        <div className="vuln-card__detail">
                          <div className="detail-grid">

                            <div className="detail-block">
                              <div className="detail-block__head">
                                <Target size={14} />
                                Root Cause Analysis
                              </div>
                              <p className="detail-block__text">{bug.reason || 'Not specified.'}</p>
                            </div>

                            <div className="detail-block">
                              <div className="detail-block__head">
                                <FileText size={14} />
                                Reproduction Steps
                              </div>
                              <pre className="detail-block__code">{bug.reproduction || 'Not specified.'}</pre>
                            </div>

                            <div className="detail-block detail-block--fix">
                              <div className="detail-block__head">
                                <CheckCircle size={14} color="var(--success)" />
                                Recommended Fix
                              </div>
                              <div className="detail-block__fix">{bug.recommendation || 'No recommendation provided.'}</div>
                              {fixSnippet && (
                                <div className="detail-fix-snippet">
                                  <button
                                    className="detail-fix-snippet__toggle"
                                    onClick={() => setExpandedFixes(prev => ({ ...prev, [key]: !prev[key] }))}
                                  >
                                    {fixOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                                    {fixOpen ? 'Hide fix snippet' : 'Show fix snippet'}
                                  </button>
                                  {fixOpen && (
                                    <pre className="detail-fix-snippet__code">{fixSnippet}</pre>
                                  )}
                                </div>
                              )}
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
      )}

      {/* ══ AI ANALYSIS TAB ════════════════════════════════════════════════ */}
      {activeSection === 'analysis' && (
        <div className="report-section">
          <div className="ai-analysis glass-card">
            <div className="ai-analysis__head">
              <div className="ai-analysis__icon">
                <Lightbulb size={18} color="#818cf8" />
              </div>
              <div>
                <h3>AI Security Assessment</h3>
                <p>Generated by llama-3.3-70b via Groq</p>
              </div>
            </div>

            <div className="ai-analysis__body">
              {results.aiAnalysis ? (
                <div className="ai-analysis__text">{results.aiAnalysis}</div>
              ) : (
                <>
                  <div className="ai-analysis__text">
                    Based on the automated scan of your target, the AI engine identified <strong>{total}</strong> issue{total !== 1 ? 's' : ''} across the selected test suites.
                  </div>

                  {total > 0 && (
                    <>
                      <div className="ai-analysis__section-title">Key Findings</div>
                      <ul className="ai-analysis__list">
                        {highCount > 0 && (
                          <li className="ai-analysis__list-item ai-analysis__list-item--high">
                            <XCircle size={14} /> {highCount} HIGH severity issue{highCount>1?'s':''} require{highCount===1?'s':''} immediate attention
                          </li>
                        )}
                        {medCount > 0 && (
                          <li className="ai-analysis__list-item ai-analysis__list-item--med">
                            <AlertTriangle size={14} /> {medCount} MEDIUM severity issue{medCount>1?'s':''} should be addressed in the next sprint
                          </li>
                        )}
                        {lowCount > 0 && (
                          <li className="ai-analysis__list-item ai-analysis__list-item--low">
                            <Info size={14} /> {lowCount} LOW severity issue{lowCount>1?'s':''} for longer-term backlog consideration
                          </li>
                        )}
                      </ul>

                      <div className="ai-analysis__section-title">Security Grade: <span style={{ color: gc }}>{results.grade}</span></div>
                      <div className="ai-analysis__text">
                        Score of {results.securityScore}/100. {
                          results.securityScore >= 90 ? 'Excellent security posture with minor improvements possible.' :
                          results.securityScore >= 75 ? 'Good overall security with some gaps that should be addressed.' :
                          results.securityScore >= 55 ? 'Moderate security posture with multiple vulnerabilities requiring remediation.' :
                          'Critical security issues present. Immediate remediation recommended before deployment.'
                        }
                      </div>
                    </>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
