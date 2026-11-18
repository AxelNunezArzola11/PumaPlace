#!/usr/bin/env node
/**
 * One-time database provisioning (`npm run db:migrate`).
 *
 * Used by the Render preDeployCommand to prepare a FRESH TiDB Cloud database:
 *   1. Creates missing tables ONLY (sequelize.sync() without alter/force —
 *      existing tables and data are never modified or dropped).
 *   2. Adds the pagos.ordenId UNIQUE backstop when the table pre-dates it.
 *   3. Seeds the default product categories (product creation requires one).
 *
 * Safe to re-run: every step is a no-op when its work already exists.
 * Never prints secret VALUES.
 */
require('dotenv').config();

const sequelize = require('../config/database');
const models = require('../infrastructure/models');

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

async function main() {
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

module.exports = { main, DEFAULT_CATEGORIES };
