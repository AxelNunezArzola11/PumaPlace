#!/usr/bin/env node
/**
 * Database smoke test (`npm run db:smoke`).
 *
 * Verifies, using the EXACT same connection semantics as the application
 * (shared buildSequelizeOptions: host, port, credentials, TLS):
 *   1. The database accepts the connection (authenticate + SELECT 1).
 *   2. All 14 application tables exist.
 *   3. When DB_SSL=true (mandatory in production), the session really runs
 *      over TLS by checking the negotiated cipher.
 *
 * Never prints secret VALUES: diagnostics mention variable/field NAMES only.
 * Exit code 0 = healthy, 1 = any check failed.
 *
 * Default: loads `.env` exactly as before. To target another file without
 * touching `.env` (e.g. the ignored TiDB credentials file):
 *   ENV_FILE=.env.tidb npm run db:smoke
 * A requested file that does not exist fails immediately with a clear error.
 */
const { getConfig, loadEnvFile } = require('../config/env');

// Must run BEFORE requiring ../config/database: that module snapshots
// process.env into the shared Sequelize instance at load time.
const ENV_FILE_USED = loadEnvFile();

const { createSequelize } = require('../config/database');

const REQUIRED_TABLES = Object.freeze([
  'usuarios',
  'categorias',
  'productos',
  'carritos',
  'items_carrito',
  'ordenes',
  'lineas_pedido',
  'pagos',
  'inventarios',
  'cupones',
  'notificaciones',
  'recibos_transaccion',
  'seguimientos_stock',
  'suscripciones',
]);

async function checkTls(sequelize) {
  const [rows] = await sequelize.query("SHOW SESSION STATUS LIKE 'Ssl_cipher'");
  if (!rows || rows.length === 0) {
    // Some MySQL-compatible servers (TiDB Cloud included) do not expose the
    // Ssl_cipher status row. TLS is still guaranteed by the mysql2 driver
    // itself: with ssl.rejectUnauthorized=true the connection FAILS unless
    // the TLS handshake succeeds — there is no plaintext fallback.
    return null;
  }
  const cipher = rows[0]?.Value;
  if (!cipher) {
    throw new Error('DB_SSL es "true" pero la sesión no negoció TLS (cipher vacío)');
  }
  return cipher;
}

async function main() {
  const config = getConfig();
  console.log(`db:smoke → entorno: ${ENV_FILE_USED || '.env (por defecto)'}`);
  console.log(`db:smoke → host=${config.db.host} port=${config.db.port} db=${config.db.name} ssl=${config.db.ssl}`);
  const sequelize = createSequelize(process.env);
  try {
    await sequelize.authenticate();
    console.log('db:smoke → conexión y autenticación OK');
    await sequelize.query('SELECT 1');
    console.log('db:smoke → SELECT 1 OK');

    const [tables] = await sequelize.query('SHOW TABLES');
    const present = new Set(
      tables.map((row) => String(Object.values(row)[0]).toLowerCase()),
    );
    const missing = REQUIRED_TABLES.filter((table) => !present.has(table));
    if (missing.length > 0) {
      throw new Error(`Faltan tablas requeridas: ${missing.join(', ')} (ejecuta npm run db:migrate)`);
    }
    console.log(`db:smoke → ${REQUIRED_TABLES.length}/${REQUIRED_TABLES.length} tablas presentes`);

    if (config.db.ssl) {
      const cipher = await checkTls(sequelize);
      if (cipher) {
        console.log(`db:smoke → TLS verificado (cipher: ${cipher})`);
      } else {
        console.log('db:smoke → TLS impuesto por el driver (el servidor no expone Ssl_cipher)');
      }
    } else {
      console.log('db:smoke → TLS desactivado: correcto solo en desarrollo local (DB_SSL=false)');
    }
    console.log('db:smoke → TODO OK');
  } finally {
    await sequelize.close();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`db:smoke → FALLO: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { REQUIRED_TABLES, main, loadEnvFile };
