#!/usr/bin/env node
/**
 * One-time database provisioning (`npm run db:migrate`).
 *
 * MANUAL workflow (Render Free has no pre-deploy commands or one-off jobs):
 * run this from your machine against TiDB Cloud BEFORE the first deploy —
 * see docs/DEPLOY-RENDER.md §2 step 5. Default: loads `.env`; to use the
 * ignored TiDB credentials file instead:
 *   ENV_FILE=.env.tidb npm run db:migrate
 * When no `.env` exists and ENV_FILE is unset, `./.env.tidb` is loaded
 * automatically when present (announced as `entorno:`); explicit ENV_FILE
 * still wins.
 * It prepares a FRESH TiDB database:
 *   1. Creates missing tables ONLY (sequelize.sync() without alter/force —
 *      existing tables and data are never modified or dropped).
 *   2. Adds the pagos.ordenId UNIQUE backstop when the table pre-dates it.
 *   3. Seeds the default product categories (product creation requires one).
 *
 * Safe to re-run: every step is a no-op when its work already exists.
 * Refuses local targets (localhost, 127.0.0.1, ::1, mysql) unless
 * ALLOW_LOCAL_MIGRATE=true, so a bare local run can never touch the MySQL
 * development database by accident.
 * Never prints secret VALUES.
 */
const { loadEnvFile } = require('../config/env');

// Same mechanism as db:smoke. Must run BEFORE requiring ../config/database:
// that module snapshots process.env into the shared Sequelize instance at
// load time, and the remote-target guard below must see the selected file.
const ENV_FILE_USED = loadEnvFile();

const sequelize = require('../config/database');
const models = require('../infrastructure/models');

// Hosts that always mean "local development" in this project.
const LOCAL_HOSTS = Object.freeze(['localhost', '127.0.0.1', '::1', '0.0.0.0', 'mysql']);

/**
 * Pure guard: resolves the migration target and refuses local databases
 * unless explicitly allowed. Exported for unit tests.
 */
function assertRemoteTarget(env = process.env) {
  const host = String(env.DB_HOST || '').trim();
  if (!host) {
    throw new Error('DB_HOST no está definido; exporta las variables de TiDB, crea .env o usa ENV_FILE=.env.tidb antes de migrar');
  }
  if (LOCAL_HOSTS.includes(host.toLowerCase())
    && String(env.ALLOW_LOCAL_MIGRATE || '').trim().toLowerCase() !== 'true') {
    throw new Error(
      `db:migrate apunta a una base LOCAL (DB_HOST=${host}). Exporta las variables de TiDB Cloud `
      + 'o repite con ALLOW_LOCAL_MIGRATE=true si realmente quieres migrar en local',
    );
  }
  return host;
}

// Must stay in sync with ensureDefaultCategories() in src/index.js.
const DEFAULT_CATEGORIES = Object.freeze([
  ['Electrónica', 'Dispositivos y accesorios electrónicos'],
  ['Ropa', 'Ropa y accesorios'],
  ['Hogar', 'Artículos para el hogar'],
  ['Herramientas', 'Herramientas y equipo'],
  ['Libros', 'Libros y material académico'],
  ['Juguetes', 'Juguetes y entretenimiento'],
  ['Mascotas', 'Artículos para mascotas'],
  ['Belleza y salud', 'Productos de belleza y salud'],
]);

async function ensurePagoOrdenIdUnique() {
  const queryInterface = sequelize.getQueryInterface();
  const indexes = await queryInterface.showIndex('pagos');
  const hasUnique = indexes.some((index) => index.unique
    && (index.fields || []).some((field) => field.attribute === 'ordenId'));
  if (hasUnique) {
    console.log('db:migrate → UNIQUE pagos.ordenId ya existe');
    return;
  }
  await queryInterface.addConstraint('pagos', {
    fields: ['ordenId'],
    type: 'unique',
    name: 'pagos_ordenId_unique',
  });
  console.log('db:migrate → UNIQUE pagos.ordenId creado');
}

async function ensureDefaultCategories() {
  for (const [nombre, descripcion] of DEFAULT_CATEGORIES) {
    await models.Categoria.findOrCreate({ where: { nombre }, defaults: { descripcion } });
  }
  console.log(`db:migrate → ${DEFAULT_CATEGORIES.length} categorías base verificadas`);
}

async function main(env = process.env) {
  const host = assertRemoteTarget(env);
  console.log(`db:migrate → entorno: ${ENV_FILE_USED || '.env (por defecto)'}`);
  console.log(`db:migrate → destino host=${host} db=${env.DB_NAME || '(vacío)'} — verifica que sea TiDB`);
  console.log('db:migrate → creando tablas faltantes (sync sin alter/force)…');
  await sequelize.authenticate();
  await sequelize.sync();
  console.log('db:migrate → sync OK');
  await ensurePagoOrdenIdUnique();
  await ensureDefaultCategories();
  console.log('db:migrate → TODO OK');
}

if (require.main === module) {
  main()
    .catch((error) => {
      console.error(`db:migrate → FALLO: ${error.message}`);
      process.exitCode = 1;
    })
    .finally(() => sequelize.close());
}

module.exports = { main, DEFAULT_CATEGORIES, assertRemoteTarget, LOCAL_HOSTS };
