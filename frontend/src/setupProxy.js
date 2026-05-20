const TRUSTED_ORIGINS = new Set(
  (process.env.REACT_APP_ALLOWED_ORIGINS || 'http://localhost:3000,http://127.0.0.1:3000')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
);

function originFrom(value) {
  try {
    return new URL(value).origin;
  } catch {
    return value;
  }
}

const API_ORIGIN = originFrom(process.env.REACT_APP_API_URL || 'http://localhost:8000');
const CONNECT_SOURCES = [
  "'self'",
  API_ORIGIN,
  'http://localhost:8000',
  'http://127.0.0.1:8000',
  'ws://localhost:3000',
  'ws://127.0.0.1:3000',
];

const SECURITY_HEADERS = {
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src ${[...new Set(CONNECT_SOURCES)].join(' ')}`,
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "form-action 'self'",
  ].join('; '),
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
};

const AUTH_PROBE_PATHS = new Set(['/login', '/api/login', '/api/auth/login', '/auth/login', '/signin']);
const DENIED_PROBE_PATHS = new Set([
  '/.env',
  '/.git/config',
  '/swagger',
  '/api/docs',
  '/api/v1/users',
  '/admin',
  '/config.json',
  '/phpinfo.php',
  '/api/swagger.json',
  '/openapi.json',
]);
const authHits = new Map();
const AUTH_LIMIT = Number(process.env.REACT_APP_AUTH_RATE_LIMIT_MAX || 5);
const AUTH_WINDOW_MS = Number(process.env.REACT_APP_AUTH_RATE_LIMIT_WINDOW_MS || 60_000);

function isHttpsRequest(req) {
  return req.secure || String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
}

function clientKey(req) {
  return `${req.ip || req.socket?.remoteAddress || 'unknown'}:${req.method}:${req.path}`;
}

function authRateLimited(req) {
  if (req.method !== 'POST' || !AUTH_PROBE_PATHS.has(req.path)) return false;

  const key = clientKey(req);
  const now = Date.now();
  const hits = (authHits.get(key) || []).filter((timestamp) => now - timestamp < AUTH_WINDOW_MS);
  if (hits.length >= AUTH_LIMIT) {
    authHits.set(key, hits);
    return true;
  }
  hits.push(now);
  authHits.set(key, hits);
  return false;
}

module.exports = function setupSecurityMiddleware(app) {
  if (typeof app.disable === 'function') {
    app.disable('x-powered-by');
  }

  app.use((req, res, next) => {
    Object.entries(SECURITY_HEADERS).forEach(([header, value]) => {
      res.setHeader(header, value);
    });

    if (isHttpsRequest(req)) {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }

    const origin = req.headers.origin;
    if (origin && TRUSTED_ORIGINS.has(origin)) {
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    } else if (origin && req.method === 'OPTIONS') {
      res.statusCode = 403;
      res.end();
      return;
    }

    if ((req.method === 'GET' || req.method === 'HEAD') && DENIED_PROBE_PATHS.has(req.path)) {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ detail: 'Not found' }));
      return;
    }

    if (authRateLimited(req)) {
      res.statusCode = 429;
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Retry-After', String(Math.ceil(AUTH_WINDOW_MS / 1000)));
      res.end(JSON.stringify({ detail: 'Too many requests. Please retry later.' }));
      return;
    }

    const writeHead = res.writeHead;
    res.writeHead = function writeHeadWithoutDisclosure(...args) {
      res.removeHeader('X-Powered-By');
      res.removeHeader('Server');
      if (res.getHeader('Access-Control-Allow-Origin') === '*') {
        res.removeHeader('Access-Control-Allow-Origin');
      }
      return writeHead.apply(this, args);
    };

    next();
  });
};
