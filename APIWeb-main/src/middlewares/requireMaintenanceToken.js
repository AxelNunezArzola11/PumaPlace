/**
 * Maintenance-endpoint authentication (dedicated service credential).
 *
 * POST /api/mantenimiento/expirar-reservas accepts ONLY the static service
 * token from MAINTENANCE_TOKEN, presented as `Authorization: Bearer <token>`.
 * Regular user JWTs — buyer, seller, or dual — are always rejected: there is
 * no admin role in this project, so maintenance never rides on user identity.
 *
 * Fail-closed behavior (all environments, no dev bypass):
 * - Server token missing/blank: 503, nothing is ever executed.
 * - Request token missing/malformed/wrong: 401.
 * - Comparison is constant-time over SHA-256 digests (no length leak) and
 *   no response ever contains a secret value.
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

function requireMaintenanceToken(req, res, next) {
  const expected = process.env.MAINTENANCE_TOKEN;
  if (!expected || String(expected).trim() === '') {
    return res.status(503).json({
      success: false,
      message: 'Mantenimiento no configurado',
      code: 'MAINTENANCE_TOKEN_MISSING',
    });
  }
  const provided = getBearerToken(req);
  if (!provided || !tokensEqual(provided, expected)) {
    return res.status(401).json({
      success: false,
      message: 'Credencial de mantenimiento inválida',
      code: 'INVALID_MAINTENANCE_TOKEN',
    });
  }
  return next();
}

module.exports = requireMaintenanceToken;
module.exports.getBearerToken = getBearerToken;
module.exports.tokensEqual = tokensEqual;
