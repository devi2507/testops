import React, { useState, useRef, useEffect } from 'react';
import { MessageCircle, X, Send, Bot, User, Sparkles } from 'lucide-react';
import '../styles/aiChat.css';
import api from '../services/api';

const SUGGESTIONS = [
  'Explain this vulnerability',
  'How to fix SQL injection?',
  'What is CORS misconfiguration?',
  'Why is this severity HIGH?',
];

// Simple local AI responses (no backend needed)
function getAiResponse(question) {
  const q = question.toLowerCase();
  if (q.includes('sql injection'))
    return 'SQL injection occurs when untrusted input is concatenated directly into SQL queries. Attackers can modify the query to read or change arbitrary data. Use parameterized queries / prepared statements and never build SQL by string concatenation.';
  if (q.includes('cors'))
    return 'CORS (Cross-Origin Resource Sharing) controls which websites can call your API from a browser. Misconfigurations (like Access-Control-Allow-Origin: *) can expose private endpoints. Prefer explicit allowed origins and avoid sending credentials to untrusted origins.';
  if (q.includes('xss') || q.includes('cross-site'))
    return 'Cross-Site Scripting (XSS) lets attackers inject JavaScript into pages viewed by other users, usually by reflecting unsanitized input back into HTML. Fix it with proper output encoding, input validation, and a strict Content-Security-Policy.';
  if (q.includes('hardcoded') && (q.includes('secret') || q.includes('key')))
    return 'A hardcoded secret key is a password, API key, token, or encryption key that is stored directly in source code. This is dangerous because it leaks via repos, logs, and client builds. Safer approaches: load secrets from environment variables or a secret manager and rotate them regularly.';
  return 'This is a basic offline explanation path. If you keep seeing this instead of richer answers, check that the backend AI service is running and the Groq API key is configured.';
}

export default function AiChat() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([
    { role: 'ai', text: 'Hi! I\'m your security assistant. Ask me about vulnerabilities, fixes, or security best practices.' },
  ]);
  const [input, setInput] = useState('');
  const [typing, setTyping] = useState(false);
  const bodyRef = useRef(null);

  const readCurrentReportContext = () => {
    try {
      const raw = localStorage.getItem('testops_current_report');
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
      return null;
    }
  };

  const buildChatHistory = (all) => {
    // Keep it lightweight: last 10 turns (user+assistant), omit the initial greeting if present.
    const trimmed = (all || [])
      .filter(m => m && (m.role === 'user' || m.role === 'ai') && typeof m.text === 'string')
      .slice(-20);

    const mapped = trimmed
      .map(m => ({
        role: m.role === 'ai' ? 'assistant' : 'user',
        content: m.text,
      }))
      .filter(m => m.content && m.content.trim().length > 0);

    return mapped.slice(-16);
  };

  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [messages, typing]);

  const send = (text) => {
    const q = text || input.trim();
    if (!q) return;
    const nextMessages = [...messages, { role: 'user', text: q }];
    setMessages(nextMessages);
    setInput('');
    setTyping(true);

    const streamText = (response) => {
      setTyping(false);
      setMessages(prev => [...prev, { role: 'ai', text: '' }]);
      let i = 0;
      const stream = setInterval(() => {
        i += 4;
        setMessages(prev => {
          const next = [...prev];
          next[next.length - 1] = { role: 'ai', text: response.slice(0, i) };
          return next;
        });
        if (i >= response.length) clearInterval(stream);
      }, 18);
    };

    // Prefer backend LLM assistant; fall back only on API failure or unrelated.
    setTimeout(async () => {
      const history = buildChatHistory(nextMessages);
      const reportContext = readCurrentReportContext();

      const attempt = async (n) => {
        try {
          const res = await api.assistantChat({ messages: history, reportContext });
          const answer = (res?.answer || '').trim();
          if (!answer) throw new Error('Empty assistant response');
          return answer;
        } catch (e) {
          console.warn(`[AiChat] assistantChat attempt ${n} failed`, e);
          throw e;
        }
      };

      try {
        const answer = await attempt(1);
        streamText(answer);
      } catch (e1) {
        // Retry once before falling back (network hiccups / cold start)
        try {
          await new Promise(r => setTimeout(r, 450));
          const answer2 = await attempt(2);
          streamText(answer2);
        } catch (e2) {
          streamText(getAiResponse(q));
        }
      }
    }, 250);
  };

  const handleKey = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } };

  return (
    <>
      {/* Toggle button */}
      <button
        className={`ai-chat-toggle ${open ? 'ai-chat-toggle--open' : ''}`}
        onClick={() => setOpen(v => !v)}
        title="AI Security Assistant"
      >
        {open ? <X size={20} /> : <Sparkles size={20} />}
      </button>

      {/* Chat panel */}
      {open && (
        <div className="ai-chat-panel animate-fade-up">
          {/* Header */}
          <div className="ai-chat-header">
            <div className="ai-chat-header__icon"><Bot size={16} /></div>
            <div>
              <div className="ai-chat-header__title">Security Assistant</div>
              <div className="ai-chat-header__sub">Ask about vulnerabilities & fixes</div>
            </div>
          </div>

          {/* Messages */}
          <div className="ai-chat-body" ref={bodyRef}>
            {messages.map((m, i) => (
              <div key={i} className={`ai-chat-msg ai-chat-msg--${m.role}`}>
                <div className="ai-chat-msg__avatar">
                  {m.role === 'ai' ? <Bot size={13} /> : <User size={13} />}
                </div>
                <div className="ai-chat-msg__text">{m.text}</div>
              </div>
            ))}
            {typing && (
              <div className="ai-chat-msg ai-chat-msg--ai">
                <div className="ai-chat-msg__avatar"><Bot size={13} /></div>
                <div className="ai-chat-typing">
                  <span /><span /><span />
                </div>
              </div>
            )}
          </div>

          {/* Suggestions */}
          {messages.length <= 2 && (
            <div className="ai-chat-suggestions">
              {SUGGESTIONS.map(s => (
                <button key={s} className="ai-chat-suggestion" onClick={() => send(s)}>
                  {s}
                </button>
              ))}
            </div>
          )}

          {/* Input */}
          <div className="ai-chat-input-bar">
            <input
              className="ai-chat-input"
              placeholder="Ask about security..."
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKey}
            />
            <button className="ai-chat-send" onClick={() => send()} disabled={!input.trim()}>
              <Send size={15} />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
