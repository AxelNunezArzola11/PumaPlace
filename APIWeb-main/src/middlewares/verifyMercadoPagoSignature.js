/**
 * Mercado Pago webhook signature verification (x-signature).
 *
 * Mercado Pago sends:
 *   x-signature: ts=<timestamp>,v1=<hex-hmac-sha256>
 *   x-request-id: <request-id>
 * and the payment id as `data.id` (query string or JSON body).
 *
 * The manifest to sign is:
 *   id:<data.id>;request-id:<x-request-id>;ts:<ts>;
 * using HMAC-SHA256 with MP_WEBHOOK_SECRET, hex-encoded.
 *
 * Fail-closed behavior:
 * - Secret configured: requests with missing/invalid/stale signatures get 401
 *   and are NEVER processed.
 * - Secret missing in production: 503 (misconfigured; Mercado Pago retries
 *   webhooks, so delivery recovers once the secret is set).
 * - Secret missing outside production: allowed with a console warning so the
 *   existing local sandbox flow keeps working without extra setup.
 */

const crypto = require('crypto');

// Signatures older than this are rejected as replayed/stale.
const MAX_SIGNATURE_AGE_MS = 15 * 60 * 1000;

function extractPaymentDataId(req) {
  return req.body?.data?.id
    || req.query?.['data.id']
    || req.query?.id
    || null;
}

function parseSignatureHeader(header) {
  if (!header || typeof header !== 'string') return null;
  const parts = Object.fromEntries(
    header.split(',').map((chunk) => {
      const index = chunk.indexOf('=');
      if (index === -1) return [];
      return [chunk.slice(0, index).trim(), chunk.slice(index + 1).trim()];
    }).filter((entry) => entry.length === 2),
  );
  if (!parts.ts || !parts.v1) return null;
  return { ts: parts.ts, v1: parts.v1 };
}

function buildManifest({ dataId, requestId, ts }) {
  return `id:${dataId};request-id:${requestId};ts:${ts};`;
}

function signManifest(manifest, secret) {
  return crypto.createHmac('sha256', secret).update(manifest).digest('hex');
}

function isFreshTimestamp(ts, now = Date.now()) {
  const tsMs = Number(ts) * 1000;
  if (!Number.isFinite(tsMs)) return false;
  return Math.abs(now - tsMs) <= MAX_SIGNATURE_AGE_MS;
}

/**
 * Pure verification used by the middleware and the test-suite.
 * @returns {{ ok: boolean, reason: string }}
 */
function verifySignature({ dataId, requestId, signatureHeader, secret, now = Date.now() }) {
  if (!secret) return { ok: false, reason: 'missing-secret' };
  if (!dataId) return { ok: false, reason: 'missing-data-id' };
  if (!requestId) return { ok: false, reason: 'missing-request-id' };
  const parsed = parseSignatureHeader(signatureHeader);
  if (!parsed) return { ok: false, reason: 'malformed-signature' };
  if (!isFreshTimestamp(parsed.ts, now)) return { ok: false, reason: 'stale-signature' };
  const expected = signManifest(buildManifest({ dataId, requestId, ts: parsed.ts }), secret);
  const received = Buffer.from(parsed.v1, 'utf8');
  const digest = Buffer.from(expected, 'utf8');
  if (received.length !== digest.length || !crypto.timingSafeEqual(received, digest)) {
    return { ok: false, reason: 'invalid-signature' };
  }
  return { ok: true, reason: 'verified' };
}

function unauthorized(res, reason) {
  return res.status(401).json({
    success: false,
    message: 'Firma del webhook inválida',
    code: 'INVALID_WEBHOOK_SIGNATURE',
    reason,
  });
}

function verifyMercadoPagoSignature(req, res, next) {
  const secret = process.env.MP_WEBHOOK_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      return res.status(503).json({
        success: false,
        message: 'Webhook no configurado: falta MP_WEBHOOK_SECRET',
        code: 'WEBHOOK_SECRET_MISSING',
      });
    }
    console.warn('[webhook] MP_WEBHOOK_SECRET no configurado; omitiendo verificación (solo desarrollo)');
    return next();
  }
  const result = verifySignature({
    dataId: extractPaymentDataId(req),
    requestId: req.headers?.['x-request-id'],
    signatureHeader: req.headers?.['x-signature'],
    secret,
  });
  if (!result.ok) return unauthorized(res, result.reason);
  return next();
}

module.exports = verifyMercadoPagoSignature;
module.exports.verifySignature = verifySignature;
module.exports.extractPaymentDataId = extractPaymentDataId;
module.exports.buildManifest = buildManifest;
module.exports.signManifest = signManifest;
module.exports.MAX_SIGNATURE_AGE_MS = MAX_SIGNATURE_AGE_MS;
