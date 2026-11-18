/**
 * Centralized environment configuration and validation.
 *
 * All production configuration comes from environment variables. This module
 * never prints or returns secret VALUES: every diagnostic mentions variable
 * NAMES only.
 */

const REQUIRED_ALWAYS = Object.freeze([
  'DB_HOST',
  'DB_PORT',
  'DB_USER',
  'DB_PASSWORD',
  'DB_NAME',
  'JWT_SECRET',
  'ENCRYPTION_KEY',
  'INDEX_KEY',
  'MP_ACCESS_TOKEN',
  'MP_WEBHOOK_URL',
]);

const REQUIRED_PRODUCTION = Object.freeze([
  ...REQUIRED_ALWAYS,
  'MP_BACK_URL_SUCCESS',
  'MP_BACK_URL_FAILURE',
  'MP_BACK_URL_PENDING',
  'FRONTEND_URL',
  'JWT_EXPIRES_IN',
  'DB_SSL',
  'PORT',
]);

const SECRET_VARIABLES = Object.freeze([
  'DB_PASSWORD',
  'JWT_SECRET',
  'ENCRYPTION_KEY',
  'INDEX_KEY',
  'MP_ACCESS_TOKEN',
  'MP_WEBHOOK_SECRET',
]);

// Development-only fallbacks so the existing local `.env` (which predates the
// back URLs) keeps working. Production must set these explicitly.
const DEV_BACK_URL_DEFAULTS = Object.freeze({
  MP_BACK_URL_SUCCESS: 'http://localhost:4200/pago/retorno/exito',
  MP_BACK_URL_FAILURE: 'http://localhost:4200/pago/retorno/fallo',
  MP_BACK_URL_PENDING: 'http://localhost:4200/pago/retorno/pendiente',
});

const PLACEHOLDER_PATTERNS = [
  /replace_with/i,
  /changeme/i,
  /placeholder/i,
  /example/i,
  /tu_secreto/i,
  /your_/i,
  /^test$/i,
  /^secret$/i,
  /^password$/i,
  /^123+$/,
];

function isProduction(env = process.env) {
  return env.NODE_ENV === 'production';
}

function isBlank(value) {
  return value === undefined || value === null || String(value).trim() === '';
}

function isValidPort(value) {
  if (isBlank(value)) return false;
  const port = Number(value);
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}

function isValidBoolean(value) {
  return ['true', 'false'].includes(String(value).trim().toLowerCase());
}

function parseBoolean(value, defaultValue = false) {
  if (isBlank(value)) return defaultValue;
  return String(value).trim().toLowerCase() === 'true';
}

function isBase64Key32Bytes(value) {
  if (isBlank(value)) return false;
  try {
    return Buffer.from(String(value).trim(), 'base64').length === 32;
  } catch (error) {
    return false;
  }
}

function isAbsoluteHttpUrl(value) {
  if (isBlank(value)) return false;
  try {
    const url = new URL(String(value).trim());
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch (error) {
    return false;
  }
}

function isHttpsUrl(value) {
  if (isBlank(value)) return false;
  try {
    return new URL(String(value).trim()).protocol === 'https:';
  } catch (error) {
    return false;
  }
}

function looksLikePlaceholder(value) {
  const text = String(value);
  return PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(text));
}

function isValidCaReference(value) {
  if (isBlank(value)) return false;
  const text = String(value).trim();
  if (text.includes('-----BEGIN')) return true;
  try {
    // eslint-disable-next-line global-require
    const fs = require('fs');
    return fs.existsSync(text);
  } catch (error) {
    return false;
  }
}

/**
 * Validates the environment without ever exposing values.
 * @returns {{ ok: boolean, missing: string[], errors: string[] }}
 */
function validateEnv(env = process.env) {
  const production = isProduction(env);
  const required = production ? REQUIRED_PRODUCTION : REQUIRED_ALWAYS;
  const missing = required.filter((name) => isBlank(env[name]));
  const errors = [];

  if (!isBlank(env.DB_PORT) && !isValidPort(env.DB_PORT)) {
    errors.push('DB_PORT debe ser un puerto numérico entre 1 y 65535');
  }
  if (production && !isBlank(env.PORT) && !isValidPort(env.PORT)) {
    errors.push('PORT debe ser un puerto numérico entre 1 y 65535');
  }
  if (!isBlank(env.DB_SSL) && !isValidBoolean(env.DB_SSL)) {
    errors.push('DB_SSL debe ser "true" o "false"');
  }
  if (production && !isBlank(env.DB_SSL) && !parseBoolean(env.DB_SSL)) {
    errors.push('DB_SSL debe ser "true" en producción: TiDB Cloud exige TLS');
  }
  if (!isBlank(env.DB_SSL_CA) && !isValidCaReference(env.DB_SSL_CA)) {
    errors.push('DB_SSL_CA debe ser un certificado PEM o la ruta de un archivo existente');
  }
  if (!isBlank(env.ENCRYPTION_KEY) && !isBase64Key32Bytes(env.ENCRYPTION_KEY)) {
    errors.push('ENCRYPTION_KEY debe ser una clave de 32 bytes codificada en base64');
  }
  if (!isBlank(env.INDEX_KEY) && !isBase64Key32Bytes(env.INDEX_KEY)) {
    errors.push('INDEX_KEY debe ser una clave de 32 bytes codificada en base64');
  }
  if (production && !isBlank(env.MP_WEBHOOK_URL) && !isHttpsUrl(env.MP_WEBHOOK_URL)) {
    errors.push('MP_WEBHOOK_URL debe ser una URL pública HTTPS en producción');
  }
  if (production) {
    for (const name of ['MP_BACK_URL_SUCCESS', 'MP_BACK_URL_FAILURE', 'MP_BACK_URL_PENDING', 'FRONTEND_URL']) {
      if (!isBlank(env[name]) && !isAbsoluteHttpUrl(env[name])) {
        errors.push(`${name} debe ser una URL absoluta válida`);
      }
    }
    for (const name of SECRET_VARIABLES) {
      if (!isBlank(env[name]) && looksLikePlaceholder(env[name])) {
        errors.push(`${name} tiene un valor de ejemplo o marcador de posición; usa un secreto real`);
      }
    }
  }

  return { ok: missing.length === 0 && errors.length === 0, missing, errors };
}

/**
 * Throws a single error listing every missing variable NAME (never values).
 */
function assertEnv(env = process.env) {
  const { ok, missing, errors } = validateEnv(env);
  if (ok) return;
  const lines = [];
  if (missing.length > 0) {
    lines.push(`Faltan variables de entorno obligatorias: ${missing.join(', ')}`);
  }
  lines.push(...errors);
  const error = new Error(lines.join(' | '));
  error.code = 'ENV_VALIDATION_FAILED';
  throw error;
}

/**
 * Normalized runtime configuration with safe defaults. Missing optional
 * values resolve to documented defaults; required values are NOT defaulted.
 */
function getConfig(env = process.env) {
  const production = isProduction(env);
  return {
    isProduction: production,
    nodeEnv: env.NODE_ENV || 'development',
    port: Number(env.PORT || 3000),
    db: {
      host: env.DB_HOST,
      port: Number(env.DB_PORT || 3306),
      user: env.DB_USER,
      password: env.DB_PASSWORD,
      name: env.DB_NAME,
      ssl: parseBoolean(env.DB_SSL, false),
      sslCa: isBlank(env.DB_SSL_CA) ? null : String(env.DB_SSL_CA),
    },
    jwt: {
      secret: env.JWT_SECRET,
      expiresIn: env.JWT_EXPIRES_IN || '24h',
    },
    frontendUrl: isBlank(env.FRONTEND_URL) ? null : String(env.FRONTEND_URL).trim(),
    mercadoPago: {
      accessToken: env.MP_ACCESS_TOKEN,
      webhookUrl: env.MP_WEBHOOK_URL,
      webhookSecret: isBlank(env.MP_WEBHOOK_SECRET) ? null : env.MP_WEBHOOK_SECRET,
      backUrls: {
        success: env.MP_BACK_URL_SUCCESS
          || (!production ? DEV_BACK_URL_DEFAULTS.MP_BACK_URL_SUCCESS : undefined),
        failure: env.MP_BACK_URL_FAILURE
          || (!production ? DEV_BACK_URL_DEFAULTS.MP_BACK_URL_FAILURE : undefined),
        pending: env.MP_BACK_URL_PENDING
          || (!production ? DEV_BACK_URL_DEFAULTS.MP_BACK_URL_PENDING : undefined),
      },
    },
  };
}

module.exports = {
  REQUIRED_ALWAYS,
  REQUIRED_PRODUCTION,
  SECRET_VARIABLES,
  DEV_BACK_URL_DEFAULTS,
  isProduction,
  isValidPort,
  isValidBoolean,
  parseBoolean,
  isBase64Key32Bytes,
  validateEnv,
  assertEnv,
  getConfig,
};
