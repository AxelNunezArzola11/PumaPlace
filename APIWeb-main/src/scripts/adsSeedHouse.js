#!/usr/bin/env node
/**
 * House-advertisement seeder (`npm run ads:seed-house`).
 *
 * MANUAL workflow, like db:migrate: run from your machine AFTER the schema
 * exists (`anuncios` table from `npm run db:migrate`). It inserts exactly
 * one clearly labeled PumaPlace house ad — promoting PumaPlace itself —
 * when no ad with the same title+advertiser exists yet. Re-running is a
 * no-op: it never duplicates, never modifies other rows, and never touches
 * any other table.
 *
 * Target selection is the same mechanism as db:migrate/db:smoke: default
 * `.env`, explicit `ENV_FILE=.env.tidb`, or the automatic `.env.tidb`
 * fallback (announced as `entorno:`). The destination host/db is always
 * printed; secret VALUES are never printed.
 *
 * This script needs direct database credentials, which is itself the
 * authorization: whoever can run it already owns the database. Day-to-day
 * ad management uses the ADS_ADMIN_TOKEN-protected HTTP endpoints instead
 * (see docs/ANUNCIOS.md) — no database access required for those.
 */
const { loadEnvFile } = require('../config/env');

// Must run BEFORE requiring ../config/database (same reason as db:migrate).
const ENV_FILE_USED = loadEnvFile();

const sequelize = require('../config/database');
const models = require('../infrastructure/models');
const { validateAnuncioInput } = require('../domain/anuncios/anuncioValidation');

const HOUSE_AD = Object.freeze({
  title: 'PumaPlace: compra y vende en tu universidad',
  description: 'Publica tus productos, encuentra ofertas de otros estudiantes y paga de forma segura. Anuncio interno de PumaPlace.',
  imageUrl: 'https://puma-place-web.onrender.com/assets/images/PumaXpress.png',
  targetUrl: 'https://puma-place-web.onrender.com/',
  advertiser: 'PumaPlace (anuncio interno)',
  placement: 'catalogo',
  active: true,
  startAt: null,
  endAt: null,
});

async function main(env = process.env) {
  console.log(`ads:seed-house → entorno: ${ENV_FILE_USED || '.env (por defecto)'}`);
  console.log(`ads:seed-house → destino host=${env.DB_HOST || '(vacío)'} db=${env.DB_NAME || '(vacío)'}`);
  const { errors, value } = validateAnuncioInput({ ...HOUSE_AD });
  if (errors) {
    throw new Error(`Anuncio interno inválido: ${errors.join('; ')}`);
  }
  await sequelize.authenticate();
  const [ad, created] = await models.Anuncio.findOrCreate({
    where: { title: HOUSE_AD.title, advertiser: HOUSE_AD.advertiser },
    defaults: value,
  });
  console.log(created
    ? `ads:seed-house → anuncio interno creado (id=${ad.id})`
    : `ads:seed-house → el anuncio interno ya existe (id=${ad.id}); sin cambios`);
}

if (require.main === module) {
  main()
    .catch((error) => {
      console.error(`ads:seed-house → FALLO: ${error.message}`);
      process.exitCode = 1;
    })
    .finally(() => sequelize.close());
}

module.exports = { main, HOUSE_AD };
