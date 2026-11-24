/**
 * CORS policy. Production explicitly allows the deployed frontend origin and
 * normalized configured origins from FRONTEND_URL / MP_BACK_URL_*.
 * Development additionally allows the local Angular dev server. Wildcards are
 * never used. Requests without an Origin header (curl, Mercado Pago webhooks)
 * are always allowed through.
 */

const PRODUCTION_FRONTEND_ORIGIN = 'https://puma-place-web.onrender.com';
const DEV_FRONTEND_ORIGIN = 'http://localhost:4200';
const ALLOWED_METHODS = Object.freeze(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);
const ALLOWED_HEADERS = Object.freeze(['Content-Type', 'Authorization', 'Accept', 'X-Requested-With']);

function normalizeOrigin(value) {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.origin;
  } catch (error) {
    return null;
  }
}

function allowedOrigins(env = process.env) {
  const origins = new Set();
  if (env.FRONTEND_URL && String(env.FRONTEND_URL).trim() !== '') {
    for (const entry of String(env.FRONTEND_URL).split(',')) {
      const normalized = normalizeOrigin(entry);
      if (normalized) origins.add(normalized);
    }
  }
  for (const key of ['MP_BACK_URL_SUCCESS', 'MP_BACK_URL_FAILURE', 'MP_BACK_URL_PENDING']) {
    const normalized = normalizeOrigin(env[key]);
    if (normalized) origins.add(normalized);
  }
  origins.add(PRODUCTION_FRONTEND_ORIGIN);
  if (env.NODE_ENV !== 'production') {
    origins.add(DEV_FRONTEND_ORIGIN);
  }
  return [...origins];
}

function buildCorsOptions(env) {
  return {
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      const origins = allowedOrigins(env || process.env);
      const normalizedRequestOrigin = normalizeOrigin(origin) || origin;
      if (origins.includes(normalizedRequestOrigin)) return callback(null, true);
      const error = new Error(`Origen no permitido por CORS: ${origin}`);
      error.status = 403;
      return callback(error);
    },
    methods: [...ALLOWED_METHODS],
    allowedHeaders: [...ALLOWED_HEADERS],
    credentials: true,
    optionsSuccessStatus: 204,
  };
}

module.exports = {
  PRODUCTION_FRONTEND_ORIGIN,
  DEV_FRONTEND_ORIGIN,
  ALLOWED_METHODS,
  ALLOWED_HEADERS,
  normalizeOrigin,
  allowedOrigins,
  buildCorsOptions,
};
