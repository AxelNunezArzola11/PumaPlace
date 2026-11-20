/**
 * Advertisement-admin authentication (dedicated service credential).
 *
 * All /api/anuncios management endpoints (list-all, read, create, update,
 * delete) accept ONLY the static service token from ADS_ADMIN_TOKEN,
 * presented as `Authorization: Bearer <token>`. Regular user JWTs — buyer,
 * seller, or dual — are always rejected: there is no admin role in this
 * project, so ad management never rides on user identity. This mirrors the
 * maintenance-endpoint credential (requireMaintenanceToken) with a separate
 * token so each capability can be rotated and scoped independently.
 *
 * Fail-closed behavior (all environments, no dev bypass):
 * - Server token missing/blank: 503, nothing is ever executed.
 * - Request token missing/malformed/wrong: 401.
 * - Comparison is constant-time over SHA-256 digests (no length leak) and
 *   no response ever contains a secret value.
 *
 * Provisioning: generate with `openssl rand -hex 32`, store in the
 * ADS_ADMIN_TOKEN environment variable (Render dashboard for production,
 * local .env for development). Never commit the value.
 */
const crypto = require('crypto');

function getBearerToken(req) {
  const header = typeof req.get === 'function'
    ? req.get('authorization')
    : req.headers?.authorization;
  if (typeof header !== 'string') return null;
  const parts = header.split(' ');
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') return null;
  const token = parts[1].trim();
  return token === '' ? null : token;
}

function tokensEqual(provided, expected) {
  const actual = crypto.createHash('sha256').update(String(provided), 'utf8').digest();
  const wanted = crypto.createHash('sha256').update(String(expected), 'utf8').digest();
  return crypto.timingSafeEqual(actual, wanted);
}

function requireAdsAdmin(req, res, next) {
  const expected = process.env.ADS_ADMIN_TOKEN;
  if (!expected || String(expected).trim() === '') {
    return res.status(503).json({
      success: false,
      message: 'Administración de anuncios no configurada',
      code: 'ADS_ADMIN_TOKEN_MISSING',
    });
  }
  const provided = getBearerToken(req);
  if (!provided || !tokensEqual(provided, expected)) {
    return res.status(401).json({
      success: false,
      message: 'Credencial de administración de anuncios inválida',
      code: 'INVALID_ADS_ADMIN_TOKEN',
    });
  }
  return next();
}

module.exports = requireAdsAdmin;
module.exports.getBearerToken = getBearerToken;
module.exports.tokensEqual = tokensEqual;
