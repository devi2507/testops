const getBackendUrl = () => {
  if (typeof window !== 'undefined') {
    const stored = localStorage.getItem('testops_backend_url');
    if (stored) return stored.replace(/\/$/, '');
  }
  return (process.env.REACT_APP_API_URL || 'http://localhost:8000').replace(/\/$/, '');
};

const HEALTH_PATHS = ['/health', '/api/health'];

async function request(path, options = {}) {
  const base = getBackendUrl();
  const res = await fetch(`${base}${path}`, {
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
  const base = getBackendUrl();
  const res = await fetch(`${base}${path}`, { method: 'POST', body: formData, ...options });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(payload.detail || 'Request failed');
  }
  return payload;
}

async function formRequestWithoutJson(path, formData, options = {}) {
  const base = getBackendUrl();
  const res = await fetch(`${base}${path}`, { method: 'POST', body: formData, ...options });
  if (!res.ok) {
    const payload = await res.json().catch(() => ({}));
    throw new Error(payload.detail || 'Request failed');
  }
  return res.json().catch(() => ({}));
}

async function healthRequest(path) {
  const base = getBackendUrl();
  try {
    const res = await fetch(`${base}${path}`, { method: 'GET' });
    return res.ok;
  } catch {
    return false;
  }
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
  get baseUrl() { return getBackendUrl(); },
  setBackendUrl: (url) => {
    if (url) {
      localStorage.setItem('testops_backend_url', url.trim().replace(/\/$/, ''));
    }
  },
  resetBackendUrl: () => {
    localStorage.removeItem('testops_backend_url');
  },
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
  getHistory:      (options = {}) => request('/api/history', options),
  getHistoryResult: async (id, options = {}) => {
    if (!id) throw new Error('Invalid report ID');
    try {
      return await request(`/api/history/${id}`, options);
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      await sleep(500);
      return request(`/api/history/${id}`, options);
    }
  },
  deleteHistoryResult: (id, options = {}) => {
    if (!id) throw new Error('Invalid report ID');
    return request(`/api/history/${id}`, { method: 'DELETE', ...options });
  },
  clearHistory:    (options = {}) => request('/api/history', { method: 'DELETE', ...options }),
  getResults:      async (id, options = {}) => {
    if (!id) throw new Error('Invalid report ID');
    try {
      return await request(`/api/test/results/${id}`, options);
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      await sleep(500);
      return request(`/api/test/results/${id}`, options);
    }
  },
  cancelScan:      (id, options = {}) => request(`/cancel-scan/${id}`, { method: 'POST', ...options }),
  startScan:       (formData, options = {}) => formRequest('/api/test/start', formData, options),
  startUrlScan:    (formData, options = {}) => formRequest('/api/test/url-start', formData, options),
  progressStream:  (testId) => new EventSource(`${getBackendUrl()}/api/test/progress/${testId}`),
  getTemplates:    () => request('/api/templates'),
  createTemplate:  (template) => request('/api/templates', { method: 'POST', body: JSON.stringify(template) }),
  deleteTemplate:  (id) => request(`/api/templates/${id}`, { method: 'DELETE' }),
  assistantChat:   (body) => request('/api/assistant/chat', { method: 'POST', body: JSON.stringify(body) }),
};

export default api;
