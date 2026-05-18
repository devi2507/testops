import React, {
  useState, useRef, useEffect, useCallback, useMemo
} from 'react';
import { Bot, X, Send, User, Sparkles, RotateCcw } from 'lucide-react';
import '../styles/aiAssistant.css';

const BASE = process.env.REACT_APP_API_URL || 'http://localhost:8000';

// ── Suggestions shown before first message ───────────────────────────────
const SUGGESTIONS = [
  'What does my scan grade mean?',
  'Explain OWASP Top 10',
  'How to fix SQL injection?',
  'How do I download a report?',
  'What is XSS?',
  'How to rerun a scan?',
  'Explain JWT security risks',
  'What is "Needs Review"?',
];

// ── Minimal markdown renderer ────────────────────────────────────────────
// Renders: headings, bold, inline code, fenced code blocks, lists, blockquotes, hr, links
function MarkdownMessage({ content }) {
  const rendered = useMemo(() => parseMarkdown(content), [content]);
  return <div className="aia-md" dangerouslySetInnerHTML={{ __html: rendered }} />;
}

function parseMarkdown(text) {
  if (!text) return '';

  // Escape HTML first (except inside code blocks)
  const codeBlocks = [];
  let safe = text.replace(/```([\w]*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    const idx = codeBlocks.length;
    codeBlocks.push({ lang: lang || 'text', code: escHtml(code.trimEnd()) });
    return `\x00CODE${idx}\x00`;
  });

  // Escape remaining HTML
  safe = safe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Inline code
  safe = safe.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Bold / italic
  safe = safe.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  safe = safe.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  safe = safe.replace(/\*(.+?)\*/g, '<em>$1</em>');

  // Links
  safe = safe.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');

  // Process line by line
  const lines = safe.split('\n');
  const out = [];
  let inList = false;
  let listType = '';

  const closeList = () => {
    if (inList) { out.push(`</${listType}>`); inList = false; listType = ''; }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Code block placeholder
    if (line.includes('\x00CODE')) {
      closeList();
      const idx = parseInt(line.match(/\x00CODE(\d+)\x00/)?.[1] ?? '0');
      const { lang, code } = codeBlocks[idx] || { lang: 'text', code: '' };
      out.push(
        `<div class="aia-code-block">` +
        `<div class="aia-code-block__header">` +
        `<span class="aia-code-block__lang">${escHtml(lang)}</span>` +
        `<button class="aia-code-block__copy" data-code="${encodeURIComponent(code)}" onclick="window.__aiaCopy(this)">` +
        `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>` +
        `Copy</button></div>` +
        `<pre><code>${code}</code></pre></div>`
      );
      continue;
    }

    // HR
    if (/^---+$/.test(line.trim())) { closeList(); out.push('<hr/>'); continue; }

    // Headings
    const hm = line.match(/^(#{1,3})\s+(.+)/);
    if (hm) { closeList(); out.push(`<h${hm[1].length}>${hm[2]}</h${hm[1].length}>`); continue; }

    // Blockquote
    if (line.startsWith('&gt; ')) {
      closeList();
      out.push(`<blockquote>${line.slice(5)}</blockquote>`);
      continue;
    }

    // Unordered list
    const ulm = line.match(/^[-*+]\s+(.+)/);
    if (ulm) {
      if (!inList || listType !== 'ul') { closeList(); out.push('<ul>'); inList = true; listType = 'ul'; }
      out.push(`<li>${ulm[1]}</li>`);
      continue;
    }

    // Ordered list
    const olm = line.match(/^\d+\.\s+(.+)/);
    if (olm) {
      if (!inList || listType !== 'ol') { closeList(); out.push('<ol>'); inList = true; listType = 'ol'; }
      out.push(`<li>${olm[1]}</li>`);
      continue;
    }

    closeList();

    if (line.trim() === '') { out.push('<br/>'); continue; }
    out.push(`<p>${line}</p>`);
  }

  closeList();
  return out.join('');
}

function escHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// Global copy handler for code blocks (called from dangerouslySetInnerHTML)
if (typeof window !== 'undefined') {
  window.__aiaCopy = (btn) => {
    const code = decodeURIComponent(btn.dataset.code || '');
    navigator.clipboard.writeText(code).then(() => {
      btn.classList.add('aia-code-block__copy--copied');
      btn.textContent = 'Copied!';
      setTimeout(() => {
        btn.classList.remove('aia-code-block__copy--copied');
        btn.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>Copy`;
      }, 2000);
    });
  };
}

// ── Read current report context from localStorage ────────────────────────
function readReportContext() {
  try {
    const raw = localStorage.getItem('testops_current_report');
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch { return null; }
}

// ── Fetch the real latest scan from the backend ──────────────────────────
async function fetchLatestScan() {
  try {
    const res = await fetch(`${BASE}/api/history`);
    if (!res.ok) return null;
    const list = await res.json();
    if (!Array.isArray(list) || list.length === 0) return null;
    // history is sorted newest-first
    return list[0];
  } catch { return null; }
}

// ── Main component ───────────────────────────────────────────────────────
export default function AiAssistant() {
  const [open, setOpen]         = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput]       = useState('');
  const [loading, setLoading]   = useState(false);
  const [hasNew, setHasNew]     = useState(false);
  const [reportCtx, setReportCtx] = useState(null);
  const [latestScan, setLatestScan] = useState(null);
  const bodyRef   = useRef(null);
  const inputRef  = useRef(null);

  // Refresh context whenever panel opens
  useEffect(() => {
    if (open) {
      setReportCtx(readReportContext());
      setHasNew(false);
      // Fetch real latest scan in background
      fetchLatestScan().then(scan => { if (scan) setLatestScan(scan); });
      setTimeout(() => inputRef.current?.focus(), 80);
    }
  }, [open]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [messages, loading]);

  const buildHistory = useCallback((msgs) => {
    return msgs
      .filter(m => m.role === 'user' || m.role === 'ai')
      .slice(-30)
      .map(m => ({
        role:    m.role === 'ai' ? 'assistant' : 'user',
        content: m.text,
      }))
      .filter(m => m.content?.trim());
  }, []);

  const send = useCallback(async (text) => {
    const q = (text || input).trim();
    if (!q || loading) return;

    const userMsg = { role: 'user', text: q, id: Date.now() };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    const ctx = readReportContext();
    setReportCtx(ctx);

    // For scan-related questions, always fetch fresh data
    const scanKeywords = ['last scan', 'latest scan', 'recent scan', 'my scan', 'my report',
      'vulnerabilities found', 'bugs found', 'what was found', 'scan result', 'my grade', 'my score'];
    const isScanQuestion = scanKeywords.some(k => q.toLowerCase().includes(k));

    let currentLatestScan = latestScan;
    if (isScanQuestion || !currentLatestScan) {
      currentLatestScan = await fetchLatestScan();
      if (currentLatestScan) setLatestScan(currentLatestScan);
    }

    try {
      const history = buildHistory([...messages, userMsg]);
      const res = await fetch(`${BASE}/api/assistant/chat`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          messages:      history,
          reportContext: ctx,
          latestScan:    currentLatestScan,
        }),
      });

      if (!res.ok) throw new Error(`Server error ${res.status}`);

      const data = await res.json();
      const answer = (data.answer || '').trim();
      if (!answer) throw new Error('Empty response');

      setMessages(prev => [...prev, { role: 'ai', text: answer, id: Date.now() }]);
      if (!open) setHasNew(true);
    } catch (err) {
      console.warn('[AiAssistant] Error:', err);
      setMessages(prev => [...prev, {
        role: 'ai',
        text: "I'm having trouble connecting right now. Please check that the backend is running and try again.",
        id:   Date.now(),
        isError: true,
      }]);
    } finally {
      setLoading(false);
    }
  }, [input, loading, messages, open, buildHistory, latestScan]);

  const handleKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  };

  const clearChat = () => {
    setMessages([]);
    setInput('');
  };

  const showSuggestions = messages.length === 0 && !loading;

  return (
    <>
      {/* ── Toggle button ── */}
      <button
        className={`aia-toggle ${open ? 'aia-toggle--open' : ''}`}
        onClick={() => setOpen(v => !v)}
        title="AI Security Assistant"
        aria-label="Toggle AI Security Assistant"
      >
        {open ? <X size={20} /> : <Sparkles size={20} />}
        {!open && hasNew && <span className="aia-badge">!</span>}
      </button>

      {/* ── Chat panel ── */}
      {open && (
        <div className="aia-panel" role="dialog" aria-label="AI Security Assistant">

          {/* Header */}
          <div className="aia-header">
            <div className="aia-header__icon">
              <Bot size={16} />
            </div>
            <div className="aia-header__info">
              <div className="aia-header__title">AI Security Assistant</div>
              <div className="aia-header__sub">
                <span className="aia-header__dot" />
                Powered by llama-3.3-70b
              </div>
            </div>
            <div className="aia-header__actions">
              {messages.length > 0 && (
                <button className="aia-header__btn" onClick={clearChat} title="Clear chat">
                  <RotateCcw size={13} />
                </button>
              )}
              <button className="aia-header__btn" onClick={() => setOpen(false)} title="Close">
                <X size={14} />
              </button>
            </div>
          </div>

          {/* Messages */}
          <div className="aia-messages" ref={bodyRef}>
            {messages.length === 0 && (
              <div className="aia-msg aia-msg--ai">
                <div className="aia-msg__avatar"><Bot size={13} /></div>
                <div className="aia-msg__bubble">
                  <div className="aia-md">
                    <p>Hi! I'm your AI Security Assistant. I can help with:</p>
                    <ul>
                      <li>Security vulnerabilities &amp; OWASP Top 10</li>
                      <li>Penetration testing &amp; VAPT</li>
                      <li>Secure coding in Python, JS, Java, Go &amp; more</li>
                      <li>Database security &amp; query optimization</li>
                      <li>DevOps, Docker, CI/CD security</li>
                      <li>Explaining your scan results &amp; grades</li>
                    </ul>
                    <p>Ask me anything.</p>
                  </div>
                </div>
              </div>
            )}

            {messages.map((m) => (
              <div key={m.id} className={`aia-msg aia-msg--${m.role}`}>
                <div className="aia-msg__avatar">
                  {m.role === 'ai' ? <Bot size={13} /> : <User size={13} />}
                </div>
                <div className="aia-msg__bubble">
                  {m.role === 'ai'
                    ? <MarkdownMessage content={m.text} />
                    : m.text
                  }
                </div>
              </div>
            ))}

            {loading && (
              <div className="aia-msg aia-msg--ai">
                <div className="aia-msg__avatar"><Bot size={13} /></div>
                <div className="aia-msg__bubble">
                  <div className="aia-typing">
                    <span /><span /><span />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Suggestions */}
          {showSuggestions && (
            <div className="aia-suggestions">
              {SUGGESTIONS.map(s => (
                <button key={s} className="aia-suggestion" onClick={() => send(s)}>
                  {s}
                </button>
              ))}
            </div>
          )}

          {/* Input */}
          <div className="aia-input-bar">
            <textarea
              ref={inputRef}
              className="aia-input"
              placeholder="Ask about security, vulnerabilities, code..."
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKey}
              rows={1}
              disabled={loading}
            />
            <button
              className="aia-send"
              onClick={() => send()}
              disabled={!input.trim() || loading}
              title="Send (Enter)"
            >
              <Send size={15} />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
