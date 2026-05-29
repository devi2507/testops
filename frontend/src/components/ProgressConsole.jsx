import React, { useEffect, useState, useRef, useMemo, useCallback } from 'react';
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

/** Map backend status to UI status */
function mapUiStatus(backendStatus) {
  if (backendStatus === 'failed') return 'error';
  if (backendStatus === 'completed') return 'completed';
  if (backendStatus === 'cancelled') return 'cancelled';
  if (backendStatus === 'running') return 'running';
  return 'pending';
}

/** Client-side fallback when server does not send log_type */
function classifyLog(msg = '') {
  const m = msg.toLowerCase();
  if (m.includes('error') || m.includes('fail') || m.includes('✗')) return 'error';
  if (m.includes('cancel') || m.includes('warn') || m.includes('⚠')) return 'warning';
  if ((m.includes('complete') || m.includes('ready')) && !m.includes('error')) return 'success';
  if (
    m.includes('...') || m.includes('connecting') || m.includes('fetching') ||
    m.includes('checking') || m.includes('running') || m.includes('probing') ||
    m.includes('inspecting') || m.includes('auditing') || m.includes('parsing')
  ) return 'warning';
  return 'info';
}

function resolveLogType(msg, serverType) {
  if (!serverType) return classifyLog(msg);
  if (serverType === 'progress') return 'warning';
  if (serverType === 'success') return 'success';
  if (serverType === 'error') return 'error';
  if (serverType === 'warning') return 'warning';
  return 'info';
}

const LOG_COLORS = {
  error:   'var(--error)',
  warning: 'var(--warning)',
  success: 'var(--success)',
  info:    'var(--info)',
};

const LOG_PREFIXES = {
  error:   '✗',
  warning: '⚠',
  success: '✓',
  info:    '›',
};

function now() {
  return new Date().toLocaleTimeString('en-GB', { hour12: false });
}

function formatServerTs(iso) {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleTimeString('en-GB', { hour12: false });
  } catch {
    return null;
  }
}

export default function ProgressConsole({ testId, onComplete, onError }) {
  const { updateScanStatus } = useActiveScan();
  const [progress, setProgress] = useState(0);
  const [logs, setLogs]         = useState([]);
  const [status, setStatus]     = useState('pending');
  const [elapsed, setElapsed]   = useState(0);
  const [logsCollapsed, setLogsCollapsed] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const bottomRef = useRef(null);
  const timerRef  = useRef(null);
  const startRef  = useRef(Date.now());
  const seenEventKeys = useRef(new Set());
  const lastMessageRef = useRef('');
  const statusRef = useRef(status);
  const onCompleteRef = useRef(onComplete);
  const onErrorRef = useRef(onError);
  const updateScanStatusRef = useRef(updateScanStatus);
  const terminalHandledRef = useRef(false);
  statusRef.current = status;
  onCompleteRef.current = onComplete;
  onErrorRef.current = onError;
  updateScanStatusRef.current = updateScanStatus;

  const appendLog = useCallback((text, type, ts) => {
    if (!text) return;
    setLogs(prev => {
      if (prev[prev.length - 1]?.text === text) return prev;
      return [...prev, { text, type, ts: ts || now() }];
    });
  }, []);

  // ── Elapsed timer ──
  useEffect(() => {
    timerRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startRef.current) / 1000));
    }, 1000);
    return () => clearInterval(timerRef.current);
  }, []);

  // ── SSE connection (queue-backed, instant delivery) ──
  useEffect(() => {
    if (!testId) return;

    seenEventKeys.current = new Set();
    lastMessageRef.current = '';
    terminalHandledRef.current = false;
    setLogs([]);
    setStatus('pending');
    setProgress(0);

    const es = api.progressStream(testId);

    const handleTerminal = (backendStatus, eventKey) => {
      if (terminalHandledRef.current) return;
      if (backendStatus === 'completed' && eventKey && eventKey !== 'scan_completed') return;

      terminalHandledRef.current = true;
      const ui = mapUiStatus(backendStatus);
      setStatus(ui);
      clearInterval(timerRef.current);
      es.close();

      if (backendStatus === 'completed') {
        updateScanStatusRef.current?.('completed', 100);
        setTimeout(() => onCompleteRef.current?.(), 600);
      } else if (backendStatus === 'cancelled') {
        updateScanStatusRef.current?.('cancelled');
        onErrorRef.current?.('Scan cancelled');
      } else if (backendStatus === 'failed') {
        updateScanStatusRef.current?.('error');
      }
    };

    es.onmessage = (event) => {
      let data;
      try {
        data = JSON.parse(event.data);
      } catch {
        return;
      }

      if (data.error || (data.event === 'error' && data.message === 'test not found')) {
        setStatus('error');
        updateScanStatusRef.current?.('error');
        appendLog(data.error || data.message || 'Scan not found', 'error', now());
        onErrorRef.current?.(data.error || data.message);
        es.close();
        return;
      }

      if (data.event === 'heartbeat') {
        setProgress(p => (typeof data.progress === 'number' ? data.progress : p));
        if (data.status === 'running') {
          setStatus('running');
          updateScanStatusRef.current?.('running', data.progress ?? 0);
        }
        return;
      }

      const prog = typeof data.progress === 'number' ? data.progress : undefined;
      if (prog !== undefined) setProgress(prog);

      const backendStatus = data.status;
      if (backendStatus === 'running') {
        setStatus('running');
        updateScanStatusRef.current?.('running', prog ?? 0);
      }

      const message = (data.message || data.latest_log || '').trim();
      if (message) {
        let skipAppend = false;
        if (data.event_key) {
          if (seenEventKeys.current.has(data.event_key)) skipAppend = true;
          else seenEventKeys.current.add(data.event_key);
        } else if (message === lastMessageRef.current) {
          skipAppend = true;
        }
        if (!skipAppend) {
          lastMessageRef.current = message;
          const type = resolveLogType(message, data.log_type);
          appendLog(message, type, formatServerTs(data.ts));
        }
      }

      if (backendStatus === 'completed') {
        handleTerminal('completed', data.event_key);
        return;
      }
      if (backendStatus === 'cancelled') {
        handleTerminal('cancelled', data.event_key);
        return;
      }
      if (backendStatus === 'failed') {
        handleTerminal('failed', data.event_key);
        if (message) onErrorRef.current?.(message);
        return;
      }
    };

    es.onerror = () => {
      if (terminalHandledRef.current || statusRef.current === 'completed' || statusRef.current === 'cancelled') return;
      setStatus('error');
      updateScanStatusRef.current?.('error');
      appendLog('Connection to backend lost.', 'error', now());
      onErrorRef.current?.('Connection to backend lost.');
      es.close();
    };

    return () => es.close();
  }, [testId, appendLog]);

  // ── Auto-scroll terminal on new log lines ──
  useEffect(() => {
    if (!logsCollapsed && logs.length > 0) {
      bottomRef.current?.scrollIntoView({ behavior: 'auto' });
    }
  }, [logs.length, logsCollapsed]);

  const currentStage = STAGES.find(s => progress >= s.from && progress < s.to) || STAGES[STAGES.length - 1];
  const estTotal     = 90;
  const estRemaining = status === 'completed' ? 0 : Math.max(0, Math.round(estTotal - elapsed));
  const pctColor = progress < 40 ? 'var(--brand-primary)' : progress < 75 ? 'var(--info)' : 'var(--success)';
  const isActive = status === 'running' || status === 'pending';

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
    if (!testId || (status !== 'running' && status !== 'pending' && status !== 'queued')) return;
    setCancelling(true);
    try {
      await api.cancelScan(testId);
      setStatus('cancelled');
      updateScanStatusRef.current?.('cancelled');
      appendLog('Cancel request sent — stopping scan...', 'warning', now());
      clearInterval(timerRef.current);
    } catch (err) {
      appendLog(`Cancel failed: ${err.message}`, 'error', now());
    } finally {
      setCancelling(false);
    }
  };

  return (
    <div className="exec-page animate-fade-up">
      <BackButton label="Back" fallback="/scan" />

      <div className="exec-header glass-card">
        <div className="exec-header__status">
          {(status === 'running' || status === 'pending') && (
            <span className="exec-status-dot exec-status-dot--running" />
          )}
          {status === 'completed' && <CheckCircle2 size={18} color="var(--success)" />}
          {status === 'cancelled' && <AlertTriangle size={18} color="var(--warning)" />}
          {status === 'error'     && <AlertTriangle size={18} color="var(--error)" />}
          <div>
            <h1 className="exec-header__title">
              {status === 'pending'   && 'Preparing Scan'}
              {status === 'running'   && 'Scan In Progress'}
              {status === 'completed' && 'Scan Complete'}
              {status === 'cancelled' && 'Scan Cancelled'}
              {status === 'error'     && 'Scan Failed'}
            </h1>
            <p className="exec-header__sub">
              {isActive ? `Currently: ${currentStage.label}` : `Test ID: ${testId?.slice(0,8)}…`}
            </p>
          </div>
        </div>

        <div className="exec-header__metrics">
          <div className="exec-metric">
            <Clock size={14} />
            <span className="exec-metric__label">Elapsed</span>
            <span className="exec-metric__value">{fmtTime(elapsed)}</span>
          </div>
          {isActive && (
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
          {(status === 'running' || status === 'pending' || status === 'queued') && (
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

      <div className="exec-progress-bar">
        <div
          className="exec-progress-bar__fill"
          style={{
            width: `${progress}%`,
            background: `linear-gradient(90deg, var(--brand-primary), ${pctColor})`,
            transition: 'width 0.35s ease',
          }}
        />
      </div>

      <div className="exec-body">
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
                  {i > 0 && (
                    <div className={`stage-line ${done || active ? 'stage-line--done' : ''}`} />
                  )}
                  <div className="stage-item__row">
                    <div className="stage-item__icon">
                      {done
                        ? <CheckCircle2 size={14} />
                        : active && isActive
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

        <div className="exec-terminal glass-card">
          <div className="terminal-bar">
            <div className="terminal-bar__dots">
              <span className="tdot tdot--red"   />
              <span className="tdot tdot--yellow" />
              <span className="tdot tdot--green"  />
            </div>
            <span className="terminal-bar__title">
              <Terminal size={12} />
              testops · activity feed
            </span>
            <button className="terminal-bar__collapse" onClick={() => setLogsCollapsed(v => !v)}>
              {logsCollapsed ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
              {logsCollapsed ? 'Expand' : 'Collapse'}
            </button>
            <span className="terminal-bar__count">{logs.length} lines</span>
          </div>

          <div className={`terminal-body ${logsCollapsed ? 'terminal-body--collapsed' : ''}`}>
            {logs.length === 0 && isActive && (
              <div className="log-row log-row--info">
                <span className="log-row__ts">{now()}</span>
                <span className="log-row__status log-row__status--info">INFO</span>
                <span className="log-row__prefix" style={{ color: LOG_COLORS.info }}>›</span>
                <span className="log-row__text" style={{ color: LOG_COLORS.info }}>Waiting for scan updates…</span>
              </div>
            )}
            {logs.map((log, i) => {
              const color  = LOG_COLORS[log.type] || LOG_COLORS.info;
              const prefix = LOG_PREFIXES[log.type] || '›';
              return (
                <div key={`${log.ts}-${i}`} className={`log-row log-row--${log.type}`}>
                  <span className="log-row__ts">{log.ts}</span>
                  <span className={`log-row__status log-row__status--${log.type}`}>{log.type.toUpperCase()}</span>
                  <span className="log-row__prefix" style={{ color }}>{prefix}</span>
                  <span className="log-row__text" style={{ color }}>{log.text}</span>
                </div>
              );
            })}

            {isActive && (
              <div className="log-row">
                <span className="log-row__ts">{now()}</span>
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
