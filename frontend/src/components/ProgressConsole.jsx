import React, { useEffect, useState, useRef, useMemo } from 'react';
import {
  Terminal, CheckCircle2, Loader2, AlertTriangle,
  Shield, Clock, Activity, Zap, Search, FileCode,
  Lock, Globe, Eye, Network, Radio, ChevronDown, ChevronUp
} from 'lucide-react';
import { useActiveScan } from '../context/ActiveScanContext';
import BackButton from './BackButton';
import api from '../services/api';
import './ProgressConsole.css';

// ── Execution stages mapped to % ranges ──────────────────────────────────
const STAGES = [
  { id: 'init',     label: 'Initializing',       icon: Radio,    from: 0,  to: 10  },
  { id: 'upload',   label: 'Processing Input',    icon: FileCode, from: 10, to: 25  },
  { id: 'probe',    label: 'Running Probes',      icon: Search,   from: 25, to: 50  },
  { id: 'ai',       label: 'AI Analysis',         icon: Zap,      from: 50, to: 80  },
  { id: 'parse',    label: 'Parsing Results',     icon: Activity, from: 80, to: 95  },
  { id: 'report',   label: 'Generating Report',   icon: Shield,   from: 95, to: 100 },
];

// ── Classify log message → type ───────────────────────────────────────────
function classifyLog(msg = '') {
  const m = msg.toLowerCase();
  if (m.includes('error') || m.includes('fail') || m.includes('✗'))        return 'error';
  if (m.includes('warn') || m.includes('⚠'))                               return 'warning';
  if (m.includes('complete') || m.includes('✓') || m.includes('found'))    return 'success';
  if (m.includes('ai') || m.includes('groq') || m.includes('analys'))      return 'ai';
  return 'info';
}

const LOG_COLORS = {
  error:   'var(--error)',
  warning: 'var(--warning)',
  success: 'var(--success)',
  ai:      '#818cf8',
  info:    'var(--text-secondary)',
};

const LOG_PREFIXES = {
  error:   '✗',
  warning: '⚠',
  success: '✓',
  ai:      '◆',
  info:    '›',
};

// ── Timestamp each log on arrival ─────────────────────────────────────────
function now() {
  return new Date().toLocaleTimeString('en-GB', { hour12: false });
}

export default function ProgressConsole({ testId, onComplete, onError }) {
  const { updateScanStatus } = useActiveScan();
  const [progress, setProgress] = useState(0);
  const [logs, setLogs]         = useState([{ text: 'TestOps AI Auditor — session started', type: 'info', ts: now() }]);
  const [status, setStatus]     = useState('running');
  const [elapsed, setElapsed]   = useState(0);
  const [logsCollapsed, setLogsCollapsed] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const bottomRef = useRef(null);
  const timerRef  = useRef(null);
  const startRef  = useRef(Date.now());

  // ── Elapsed timer ──
  useEffect(() => {
    timerRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startRef.current) / 1000));
    }, 1000);
    return () => clearInterval(timerRef.current);
  }, []);

  // ── SSE connection ──
  useEffect(() => {
    if (!testId) return;
    const es = api.progressStream(testId);

    es.onmessage = (event) => {
      const data = JSON.parse(event.data);

      if (data.error) {
        setStatus('error');
        updateScanStatus('error');
        setLogs(p => [...p, { text: data.error, type: 'error', ts: now() }]);
        onError?.(data.error);
        es.close();
        return;
      }

      setProgress(data.progress || 0);
      updateScanStatus('running', data.progress || 0);

      if (data.latest_log) {
        setLogs(prev => {
          const lastText = prev[prev.length - 1]?.text;
          if (lastText === data.latest_log) return prev;
          return [...prev, { text: data.latest_log, type: classifyLog(data.latest_log), ts: now() }];
        });
      }

      if (data.status === 'completed') {
        setStatus('completed');
        updateScanStatus('completed', 100);
        clearInterval(timerRef.current);
        setLogs(p => [...p, { text: 'Audit complete — loading report…', type: 'success', ts: now() }]);
        es.close();
        setTimeout(onComplete, 1400);
        return;
      }

      if (data.status === 'cancelled') {
        setStatus('cancelled');
        updateScanStatus('cancelled');
        clearInterval(timerRef.current);
        setLogs(p => [...p, { text: 'Scan cancelled by user.', type: 'warning', ts: now() }]);
        es.close();
        onError?.('Scan cancelled');
        return;
      }

      if (data.status === 'failed') {
        setStatus('error');
        updateScanStatus('error');
        const msg = data.logs?.slice(-1)[0] || 'Analysis failed';
        setLogs(p => [...p, { text: msg, type: 'error', ts: now() }]);
        onError?.(msg);
        es.close();
      }
    };

    es.onerror = () => {
      setStatus('error');
      setLogs(p => [...p, { text: 'Connection to backend lost.', type: 'error', ts: now() }]);
      onError?.('Connection to backend lost.');
      es.close();
    };

    return () => es.close();
  }, [testId]);

  // ── Auto-scroll terminal ──
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  // ── Derived state ──
  const currentStage = STAGES.find(s => progress >= s.from && progress < s.to) || STAGES[STAGES.length - 1];
  const estTotal     = 90; // seconds
  const estRemaining = status === 'completed' ? 0 : Math.max(0, Math.round(estTotal - elapsed));
  const pctColor = progress < 40 ? 'var(--brand-primary)' : progress < 75 ? 'var(--info)' : 'var(--success)';

  const fmtTime = (s) => `${String(Math.floor(s / 60)).padStart(2,'0')}:${String(s % 60).padStart(2,'0')}`;
  const severityCounts = useMemo(() => {
    const counts = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
    const seen = new Set();
    logs.forEach(l => {
      const txt = (l.text || '').toUpperCase();
      Object.keys(counts).forEach(level => {
        if (txt.includes(level)) {
          const key = `${level}:${l.text}`;
          if (!seen.has(key)) {
            counts[level] += 1;
            seen.add(key);
          }
        }
      });
    });
    return counts;
  }, [logs]);

  const cancelScan = async () => {
    if (!testId || (status !== 'running' && status !== 'queued')) return;
    setCancelling(true);
    try {
      await api.cancelScan(testId);
      setStatus('cancelled');
      updateScanStatus('cancelled');
      setLogs(p => [...p, { text: 'Cancel request sent — stopping scan...', type: 'warning', ts: now() }]);
      clearInterval(timerRef.current);
    } catch (err) {
      setLogs(p => [...p, { text: `Cancel failed: ${err.message}`, type: 'error', ts: now() }]);
    } finally {
      setCancelling(false);
    }
  };

  return (
    <div className="exec-page animate-fade-up">
      <BackButton label="Back" fallback="/scan" />

      {/* ═══ TOP HEADER ═══════════════════════════════════════════════════ */}
      <div className="exec-header glass-card">
        <div className="exec-header__status">
          {status === 'running'   && <span className="exec-status-dot exec-status-dot--running" />}
          {status === 'completed' && <CheckCircle2 size={18} color="var(--success)" />}
          {status === 'cancelled' && <AlertTriangle size={18} color="var(--warning)" />}
          {status === 'error'     && <AlertTriangle size={18} color="var(--error)" />}
          <div>
            <h1 className="exec-header__title">
              {status === 'running'   && 'Scan In Progress'}
              {status === 'completed' && 'Scan Complete'}
              {status === 'cancelled' && 'Scan Cancelled'}
              {status === 'error'     && 'Scan Failed'}
            </h1>
            <p className="exec-header__sub">
              {status === 'running' ? `Currently: ${currentStage.label}` : `Test ID: ${testId?.slice(0,8)}…`}
            </p>
          </div>
        </div>

        {/* Metrics row */}
        <div className="exec-header__metrics">
          <div className="exec-metric">
            <Clock size={14} />
            <span className="exec-metric__label">Elapsed</span>
            <span className="exec-metric__value">{fmtTime(elapsed)}</span>
          </div>
          {status === 'running' && (
            <div className="exec-metric">
              <Activity size={14} />
              <span className="exec-metric__label">Est. remaining</span>
              <span className="exec-metric__value">{fmtTime(estRemaining)}</span>
            </div>
          )}
          <div className="exec-metric">
            <Zap size={14} />
            <span className="exec-metric__label">Progress</span>
            <span className="exec-metric__value" style={{ color: pctColor }}>{progress}%</span>
          </div>
          <div className="exec-metric exec-metric--severity">
            <span className="sev-chip sev-chip--critical">C {severityCounts.CRITICAL}</span>
            <span className="sev-chip sev-chip--high">H {severityCounts.HIGH}</span>
            <span className="sev-chip sev-chip--medium">M {severityCounts.MEDIUM}</span>
            <span className="sev-chip sev-chip--low">L {severityCounts.LOW}</span>
          </div>
          {(status === 'running' || status === 'queued') && (
            <button
              type="button"
              className="exec-stop-btn"
              onClick={cancelScan}
              disabled={cancelling}
            >
              {cancelling ? 'Cancelling…' : 'Stop Scan'}
            </button>
          )}
        </div>
      </div>

      {/* ═══ PROGRESS BAR ══════════════════════════════════════════════════ */}
      <div className="exec-progress-bar">
        <div
          className="exec-progress-bar__fill"
          style={{
            width: `${progress}%`,
            background: `linear-gradient(90deg, var(--brand-primary), ${pctColor})`,
          }}
        />
      </div>

      {/* ═══ BODY: Timeline + Terminal ════════════════════════════════════ */}
      <div className="exec-body">

        {/* ── Left: Stage Timeline ── */}
        <div className="exec-timeline glass-card">
          <div className="exec-timeline__title">
            <Activity size={14} />
            Execution Stages
          </div>
          <div className="exec-timeline__stages">
            {STAGES.map((stage, i) => {
              const done   = progress >= stage.to;
              const active = progress >= stage.from && progress < stage.to;
              const Icon   = stage.icon;
              return (
                <div key={stage.id} className={`stage-item ${done ? 'stage-item--done' : ''} ${active ? 'stage-item--active' : ''}`}>
                  {/* Connector line */}
                  {i > 0 && (
                    <div className={`stage-line ${done || active ? 'stage-line--done' : ''}`} />
                  )}
                  <div className="stage-item__row">
                    <div className="stage-item__icon">
                      {done
                        ? <CheckCircle2 size={14} />
                        : active && (status === 'running' || status === 'queued')
                          ? <Loader2 size={14} className="spin" />
                          : <Icon size={14} />}
                    </div>
                    <div className="stage-item__text">
                      <span className="stage-item__label">{stage.label}</span>
                      <span className="stage-item__range">{stage.from}% → {stage.to}%</span>
                    </div>
                    {done   && <span className="stage-item__badge stage-item__badge--done">Done</span>}
                    {active && <span className="stage-item__badge stage-item__badge--active">Active</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Right: Terminal ── */}
        <div className="exec-terminal glass-card">
          {/* Terminal topbar */}
          <div className="terminal-bar">
            <div className="terminal-bar__dots">
              <span className="tdot tdot--red"   />
              <span className="tdot tdot--yellow" />
              <span className="tdot tdot--green"  />
            </div>
            <span className="terminal-bar__title">
              <Terminal size={12} />
              testops · live output
            </span>
            <button className="terminal-bar__collapse" onClick={() => setLogsCollapsed(v => !v)}>
              {logsCollapsed ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
              {logsCollapsed ? 'Expand' : 'Collapse'}
            </button>
            <span className="terminal-bar__count">{logs.length} lines</span>
          </div>

          {/* Log body */}
          <div className={`terminal-body ${logsCollapsed ? 'terminal-body--collapsed' : ''}`}>
            {logs.map((log, i) => {
              const color  = LOG_COLORS[log.type] || LOG_COLORS.info;
              const prefix = LOG_PREFIXES[log.type] || '›';
              return (
                <div key={i} className={`log-row log-row--${log.type}`}>
                  <span className="log-row__ts">{log.ts}</span>
                  <span className={`log-row__status log-row__status--${log.type}`}>{log.type.toUpperCase()}</span>
                  <span className="log-row__prefix" style={{ color }}>{prefix}</span>
                  <span className="log-row__text" style={{ color }}>{log.text}</span>
                </div>
              );
            })}

            {status === 'running' && (
              <div className="log-row">
                <span className="log-row__ts">--:--:--</span>
                <span className="log-cursor blink">█</span>
              </div>
            )}

            <div ref={bottomRef} />
          </div>
        </div>
      </div>

    </div>
  );
}
