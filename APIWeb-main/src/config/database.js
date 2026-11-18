const fs = require('fs');
const { Sequelize } = require('sequelize');
require('dotenv').config();

const { parseBoolean, isValidBoolean } = require('./env');

function loadSslCa(rawValue) {
  const text = String(rawValue).trim();
  if (text.includes('-----BEGIN')) return text;
  // Otherwise it must be a path to a PEM file. validateEnv() already rejects
  // values that are neither; this throw is a fail-closed last resort.
  if (fs.existsSync(text)) return fs.readFileSync(text, 'utf8');
  throw new Error('DB_SSL_CA debe ser un certificado PEM o la ruta de un archivo existente');
}

/**
 * Builds Sequelize options from the given environment mapping.
 * Shared by normal application startup and the database smoke test so both
 * always use the exact same connection semantics (host, port, credentials,
 * TLS). Supports TiDB Cloud usernames verbatim, including any cluster prefix.
 */
function buildSequelizeOptions(env = process.env) {
  const options = {
    dialect: 'mysql',
    host: env.DB_HOST,
    port: Number(env.DB_PORT || 3306),
    username: env.DB_USER,
    password: env.DB_PASSWORD,
    database: env.DB_NAME,
    logging: false,
  };
  if (!isValidBoolean(env.DB_SSL || '') && (env.DB_SSL || '') !== '') {
    throw new Error('DB_SSL debe ser "true" o "false"');
  }
  if (parseBoolean(env.DB_SSL, false)) {
    const ssl = {
      minVersion: 'TLSv1.2',
      // Certificate verification is ALWAYS enabled. There is intentionally no
      // option to disable it.
      rejectUnauthorized: true,
    };
    if (env.DB_SSL_CA !== undefined && env.DB_SSL_CA !== null && String(env.DB_SSL_CA).trim() !== '') {
      ssl.ca = loadSslCa(env.DB_SSL_CA);
    }
    options.dialectOptions = { ...(options.dialectOptions || {}), ssl };
  }
  return options;
}

function createSequelize(env = process.env) {
  return new Sequelize(buildSequelizeOptions(env));
}

const sequelize = createSequelize(process.env);

module.exports = sequelize;
module.exports.buildSequelizeOptions = buildSequelizeOptions;
module.exports.createSequelize = createSequelize;
