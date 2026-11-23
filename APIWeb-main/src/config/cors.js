/**
 * CORS policy. Production allows ONLY the configured frontend origin.
 * Development additionally allows the local Angular dev server. Wildcards are
 * never used. Requests without an Origin header (curl, Mercado Pago webhooks)
 * are always allowed through.
 */

function allowedOrigins(env = process.env) {
  const origins = [];
  if (env.FRONTEND_URL && String(env.FRONTEND_URL).trim() !== '') {
    origins.push(String(env.FRONTEND_URL).trim());
  }
  if (env.NODE_ENV !== 'production') {
    origins.push('http://localhost:4200');
  }
  return origins;
}

function buildCorsOptions(env = process.env) {
  const origins = allowedOrigins(env);
  return {
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (origins.includes(origin)) return callback(null, true);
      const error = new Error(`Origen no permitido por CORS: ${origin}`);
      error.status = 403;
      return callback(error);
    },
    credentials: false,
    optionsSuccessStatus: 204,
  };
}

module.exports = { allowedOrigins, buildCorsOptions };
