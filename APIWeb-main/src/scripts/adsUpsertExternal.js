#!/usr/bin/env node
/**
 * External-link ad upsert (`npm run ads:upsert-external`).
 *
 * Creates or updates exactly ONE advertisement row — the informative
 * external link "Encuentra más productos en Mercado Libre" — matched by
 * its fixed title+advertiser. It never touches any other row or table, and
 * re-running with the same inputs is a no-op for unchanged fields.
 *
 * This is NOT a sponsorship: the copy claims no endorsement, recommendation,
 * or official alliance with Mercado Libre, and the storefront labels the
 * card as ENLACE EXTERNO. Likewise, no third-party logo or image is ever
 * invented here: the image MUST arrive via ADS_EXTERNAL_IMAGE_URL, must be
 * an authorized resource, and must pass the shared HTTPS validation.
 * The script refuses to run without it.
 *
 * Target selection matches db:migrate/db:smoke (default `.env`, explicit
 * ENV_FILE, or automatic `.env.tidb` fallback). Prints host/db only —
 * never secret values (the ad content itself is public by design).
 *
 * Verification support (documented, single-row only): ADS_ACTIVE=false
 * writes the row inactive so the operator can confirm it stays out of the
 * public endpoint; a second run without the override activates it.
 * ADS_END_AT accepts an ISO date to temporarily bound validity for the
 * same check; omit it (or set empty) for the final unbounded state.
 * Direct database credentials are themselves the authorization, exactly
 * like db:migrate and ads:seed-house.
 */
const { loadEnvFile } = require('../config/env');

// Must run BEFORE requiring ../config/database (same reason as db:migrate).
const ENV_FILE_USED = loadEnvFile();

const sequelize = require('../config/database');
const models = require('../infrastructure/models');
const { validateAnuncioInput } = require('../domain/anuncios/anuncioValidation');

const EXTERNAL_AD = Object.freeze({
  title: 'Encuentra más productos en Mercado Libre',
  description: 'Descubre miles de productos, ofertas y opciones de compra en Mercado Libre.',
  targetUrl: 'https://www.mercadolibre.com.mx/',
  advertiser: 'Mercado Libre',
  placement: 'catalogo',
  active: true,
  startAt: null,
  endAt: null,
});

function resolveActive(env) {
  const raw = env.ADS_ACTIVE;
  if (raw === undefined || raw === null || String(raw).trim() === '') return true;
  const text = String(raw).trim().toLowerCase();
  if (text === 'false' || text === '0') return false;
  if (text === 'true' || text === '1') return true;
  throw new Error('ADS_ACTIVE debe ser "true" o "false"');
}

async function main(env = process.env) {
  console.log(`ads:upsert-external → entorno: ${ENV_FILE_USED || '.env (por defecto)'}`);
  console.log(`ads:upsert-external → destino host=${env.DB_HOST || '(vacío)'} db=${env.DB_NAME || '(vacío)'}`);
  const imageUrl = env.ADS_EXTERNAL_IMAGE_URL;
  if (typeof imageUrl !== 'string' || imageUrl.trim() === '') {
    throw new Error(
      'Falta ADS_EXTERNAL_IMAGE_URL: indica la URL HTTPS del recurso de imagen AUTORIZADO; '
      + 'el script nunca inventa ni reutiliza logotipos de terceros',
    );
  }
  const endAt = env.ADS_END_AT !== undefined && String(env.ADS_END_AT).trim() !== ''
    ? String(env.ADS_END_AT).trim()
    : null;
  const { errors, value } = validateAnuncioInput({
    ...EXTERNAL_AD,
    imageUrl: imageUrl.trim(),
    active: resolveActive(env),
    endAt,
  });
  if (errors) {
    throw new Error(`Anuncio externo inválido: ${errors.join('; ')}`);
  }
  await sequelize.authenticate();
  const where = { title: EXTERNAL_AD.title, advertiser: EXTERNAL_AD.advertiser };
  const existing = await models.Anuncio.findOne({ where });
  if (!existing) {
    const created = await models.Anuncio.create(value);
    console.log(`ads:upsert-external → anuncio externo creado (id=${created.id}, active=${created.active})`);
    return;
  }
  await existing.update(value);
  console.log(`ads:upsert-external → anuncio externo actualizado (id=${existing.id}, active=${value.active})`);
}

if (require.main === module) {
  main()
    .catch((error) => {
      console.error(`ads:upsert-external → FALLO: ${error.message}`);
      process.exitCode = 1;
    })
    .finally(() => sequelize.close());
}

module.exports = { main, EXTERNAL_AD, resolveActive };
