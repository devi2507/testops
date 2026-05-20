const BASE = process.env.REACT_APP_API_URL || 'http://localhost:8000';
const HEALTH_PATHS = ['/health', '/api/health'];

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

async function formRequest(path, formData, options = {}) {
  const res = await fetch(`${BASE}${path}`, { method: 'POST', body: formData, ...options });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(payload.detail || 'Request failed');
  }
  return payload;
}

async function formRequestWithoutJson(path, formData, options = {}) {
  const res = await fetch(`${BASE}${path}`, { method: 'POST', body: formData, ...options });
  if (!res.ok) {
    const payload = await res.json().catch(() => ({}));
    throw new Error(payload.detail || 'Request failed');
  }
  return res.json().catch(() => ({}));
}

async function healthRequest(path) {
  const res = await fetch(`${BASE}${path}`, { method: 'GET' });
  return res.ok;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForBackend({ attempts = 12, interval = 1000 } = {}) {
  let lastError = null;
  for (let i = 0; i < attempts; i += 1) {
    for (const path of HEALTH_PATHS) {
      try {
        if (await healthRequest(path)) {
          return true;
        }
      } catch (error) {
        lastError = error;
      }
    }
    await sleep(interval);
  }
  throw lastError || new Error('Backend health check failed');
}

export const api = {
  baseUrl: BASE,
  health: async () => {
    for (const path of HEALTH_PATHS) {
      try {
        return await request(path);
      } catch {
        // ignore and try next path
      }
    }
    throw new Error('Health check failed');
  },
  waitForBackend,
  getHistory:      ()   => request('/api/history'),
  getHistoryResult: (id) => request(`/api/history/${id}`),
  deleteHistoryResult: (id) => request(`/api/history/${id}`, { method: 'DELETE' }),
  clearHistory:    ()   => request('/api/history', { method: 'DELETE' }),
  getResults:      (id) => request(`/api/test/results/${id}`),
  cancelScan:      (id) => request(`/cancel-scan/${id}`, { method: 'POST' }),
  startScan:       (formData) => formRequest('/api/test/start', formData),
  startUrlScan:    (formData) => formRequest('/api/test/url-start', formData),
  progressStream:  (testId) => new EventSource(`${BASE}/api/test/progress/${testId}`),
  getTemplates:    () => request('/api/templates'),
  createTemplate:  (template) => request('/api/templates', { method: 'POST', body: JSON.stringify(template) }),
  deleteTemplate:  (id) => request(`/api/templates/${id}`, { method: 'DELETE' }),
  assistantChat:   (body) => request('/api/assistant/chat', { method: 'POST', body: JSON.stringify(body) }),
};

export default api;
