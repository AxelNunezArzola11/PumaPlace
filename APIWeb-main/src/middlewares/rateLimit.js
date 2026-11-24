/**
 * Rate limiting (express-rate-limit, in-memory store).
 *
 * Render Free runs a SINGLE instance, so the default memory store is
 * consistent there. Limits reset on restart/sleep and would NOT be shared
 * if the service ever scaled out — documented in docs/DEPLOY-RENDER.md.
 *
 * Exclusions (by design, never by accident):
 * - `/health` is not under any limiter mount point.
 * - `POST /api/pagos/webhook` is skipped: Mercado Pago retries must never
 *   meet a 429 (signature verification is the webhook's protection).
 * - `OPTIONS` preflights never consume quota.
 *
 * Client IP comes from Express `req.ip` with `trust proxy` set to exactly
 * 1 (Render's single reverse proxy). Never `true`: that would let anyone
 * spoof X-Forwarded-For and pick a fresh bucket per request.
 */
const { rateLimit } = require('express-rate-limit');

const WEBHOOK_PATH = '/api/pagos/webhook';

function isWebhook(req) {
  const url = req.originalUrl || '';
  return url === WEBHOOK_PATH || url.startsWith(`${WEBHOOK_PATH}?`);
}

function limitedHandler(scope) {
  // eslint-disable-next-line no-unused-vars
  return (req, res, next, options) => res.status(429).json({
    success: false,
    message: 'Demasiadas solicitudes; inténtalo de nuevo en unos minutos',
    code: 'RATE_LIMITED',
    scope,
  });
}

function baseOptions(windowMs) {
  return {
    windowMs,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
  };
}

/**
 * Builds every limiter from one validated config object
 * ({ windowMs, generalMax, authMax, registerMax, preferenciaMax }).
 */
function createLimiters(config) {
  const base = baseOptions(config.windowMs);
  const apiLimiter = rateLimit({
    ...base,
    limit: config.generalMax,
    handler: limitedHandler('api'),
    skip: (req) => req.method === 'OPTIONS' || isWebhook(req),
  });
  const loginLimiter = rateLimit({
    ...base,
    limit: config.authMax,
    handler: limitedHandler('auth'),
    skip: (req) => req.method === 'OPTIONS',
  });
  const registerLimiter = rateLimit({
    ...base,
    limit: config.registerMax,
    handler: limitedHandler('auth'),
    skip: (req) => req.method === 'OPTIONS',
  });
  const preferenciaLimiter = rateLimit({
    ...base,
    limit: config.preferenciaMax,
    handler: limitedHandler('pagos'),
    skip: (req) => req.method === 'OPTIONS',
  });
  return { apiLimiter, loginLimiter, registerLimiter, preferenciaLimiter };
}

module.exports = { createLimiters, isWebhook, WEBHOOK_PATH };
