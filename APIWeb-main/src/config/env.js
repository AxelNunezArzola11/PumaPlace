/**
 * Centralized environment configuration and validation.
 *
 * All production configuration comes from environment variables. This module
 * never prints or returns secret VALUES: every diagnostic mentions variable
 * NAMES only.
 */

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

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
  // Optional at boot (the maintenance endpoint 503s without it), but when
  // set it must still pass the production placeholder check below.
  'MAINTENANCE_TOKEN',
  // Optional at boot (ad management 503s without it), same placeholder rule.
  'ADS_ADMIN_TOKEN',
]);

// Development-only fallbacks so the existing local `.env` (which predates the
// back URLs) keeps working. Production must set these explicitly.
const DEV_BACK_URL_DEFAULTS = Object.freeze({
  MP_BACK_URL_SUCCESS: 'http://localhost:4200/pago/retorno/exito',
  MP_BACK_URL_FAILURE: 'http://localhost:4200/pago/retorno/fallo',
  MP_BACK_URL_PENDING: 'http://localhost:4200/pago/retorno/pendiente',
});

// Optional rate-limit tuning. Defaults are generous on purpose: they stop
// floods, never legitimate shopping, polling (4s) or payment flows.
const RATE_LIMIT_DEFAULTS = Object.freeze({
  windowMs: 15 * 60 * 1000,
  generalMax: 600,
  authMax: 20,
  registerMax: 10,
  preferenciaMax: 30,
});

const RATE_LIMIT_BOUNDS = Object.freeze({
  RATE_LIMIT_WINDOW_MS: { min: 1000, max: 3600000 },
  RATE_LIMIT_GENERAL_MAX: { min: 1, max: 100000 },
  RATE_LIMIT_AUTH_MAX: { min: 1, max: 100000 },
  RATE_LIMIT_REGISTER_MAX: { min: 1, max: 100000 },
  RATE_LIMIT_PREFERENCIA_MAX: { min: 1, max: 100000 },
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

/**
 * Loads the default `.env`, or the explicit file named in ENV_FILE.
 * When ENV_FILE is unset and no `./.env` exists, falls back to the
 * conventional `./.env.tidb` TiDB credentials file when present — the
 * persistent alternative the migration docs describe, which bare
 * `db:smoke`/`db:migrate` runs would otherwise never see. Explicit
 * ENV_FILE still wins (and still throws when missing); an existing
 * `./.env` still wins over the fallback; exported variables are never
 * overridden (dotenv). Only the one-shot provisioning scripts use this
 * loader: the long-lived app (config/database.js) keeps loading `./.env`
 * alone, so normal development can never silently point at TiDB.
 * Shared verbatim by `db:smoke` and `db:migrate` so both scripts select
 * environment files through one mechanism. Never prints or returns VALUES.
 * @returns {string|null} the file used as given (or the fallback name), or null for default.
 */
function loadEnvFile(env = process.env) {
  const requested = env.ENV_FILE;
  if (requested === undefined || requested === null || String(requested).trim() === '') {
    dotenv.config();
    if (!fs.existsSync(path.resolve('.env')) && fs.existsSync(path.resolve('.env.tidb'))) {
      dotenv.config({ path: path.resolve('.env.tidb') });
      return '.env.tidb';
    }
    return null;
  }
  const file = String(requested).trim();
  if (!fs.existsSync(path.resolve(file))) {
    throw new Error(`ENV_FILE no existe: ${file} (buscado desde ${process.cwd()})`);
  }
  dotenv.config({ path: path.resolve(file) });
  return file;
}

function isValidPositiveInt(value, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (isBlank(value)) return false;
  const num = Number(value);
  return Number.isInteger(num) && num >= min && num <= max;
}

function positiveIntOr(value, defaultValue) {
  if (isBlank(value)) return defaultValue;
  return Number(value);
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
  for (const [name, bounds] of Object.entries(RATE_LIMIT_BOUNDS)) {
    if (!isBlank(env[name]) && !isValidPositiveInt(env[name], bounds)) {
      errors.push(`${name} debe ser un entero entre ${bounds.min} y ${bounds.max}`);
    }
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
    rateLimit: {
      windowMs: positiveIntOr(env.RATE_LIMIT_WINDOW_MS, RATE_LIMIT_DEFAULTS.windowMs),
      generalMax: positiveIntOr(env.RATE_LIMIT_GENERAL_MAX, RATE_LIMIT_DEFAULTS.generalMax),
      authMax: positiveIntOr(env.RATE_LIMIT_AUTH_MAX, RATE_LIMIT_DEFAULTS.authMax),
      registerMax: positiveIntOr(env.RATE_LIMIT_REGISTER_MAX, RATE_LIMIT_DEFAULTS.registerMax),
      preferenciaMax: positiveIntOr(env.RATE_LIMIT_PREFERENCIA_MAX, RATE_LIMIT_DEFAULTS.preferenciaMax),
    },
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
  RATE_LIMIT_DEFAULTS,
  RATE_LIMIT_BOUNDS,
  DEV_BACK_URL_DEFAULTS,
  isProduction,
  isValidPort,
  isValidBoolean,
  isValidPositiveInt,
  parseBoolean,
  isBase64Key32Bytes,
  validateEnv,
  assertEnv,
  getConfig,
  loadEnvFile,
};
