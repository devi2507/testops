const BASE = process.env.REACT_APP_API_URL || 'http://localhost:8000';

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || 'Request failed');
  }
  return res.json();
}

// ── History ──────────────────────────────────────────────────────────────
export const api = {
  getHistory:      ()   => request('/api/history'),
  getHistoryResult: (id) => request(`/api/history/${id}`),
  clearHistory:    ()   => request('/api/history', { method: 'DELETE' }),
  getResults:      (id) => request(`/api/test/results/${id}`),

  startScan: (formData) =>
    fetch(`${BASE}/api/test/start`, { method: 'POST', body: formData }).then(r => r.json()),

  startUrlScan: (formData) =>
    fetch(`${BASE}/api/test/url-start`, { method: 'POST', body: formData }).then(r => r.json()),

  progressStream: (testId) =>
    new EventSource(`${BASE}/api/test/progress/${testId}`),

  assistantChat: ({ messages, reportContext }) =>
    request('/api/assistant/chat', {
      method: 'POST',
      body: JSON.stringify({ messages, reportContext }),
    }),
};

export default api;
