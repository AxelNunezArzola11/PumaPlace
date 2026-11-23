/**
 * Advertisement routes (mounted at /api/anuncios by routes/api.js).
 *
 * Public:
 * - GET /activos — active ads within their validity window, public
 *   projection only (no scheduling or administrative fields). Optional
 *   `placement` filter and bounded `limit` (default 10, max 50).
 *
 * Administration (ADS_ADMIN_TOKEN service credential ONLY — regular user
 * JWTs are always rejected, since there is no admin role):
 * - GET / — every ad, newest first, paginated (default limit 20, max 100).
 * - GET /:id — one ad with all fields, or 404.
 * - POST / — create (validated; HTTPS URLs, localhost http only in dev).
 * - PATCH /:id — edit, activate or deactivate (validated partial update).
 * - DELETE /:id — delete (204) or 404.
 */
const express = require('express');
const { rateLimit } = require('express-rate-limit');
const { Op } = require('sequelize');
const models = require('../infrastructure/models');
const CrudRepository = require('../infrastructure/repositories/CrudRepository');
const requireAdsAdmin = require('../middlewares/requireAdsAdmin');
const {
  PLACEMENTS,
  validateAnuncioInput,
  serializeAnuncioPublico,
} = require('../domain/anuncios/anuncioValidation');

const PUBLIC_DEFAULT_LIMIT = 10;
const PUBLIC_MAX_LIMIT = 50;
const ADMIN_DEFAULT_LIMIT = 20;
const ADMIN_MAX_LIMIT = 100;

// Dedicated public-endpoint limiter (in addition to the general /api
// limiter): the catalog calls this on every visit, so it gets its own
// bucket that ad polling can never exhaust for other endpoints. Skipped in
// the test environment for deterministic route tests.
const activosLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: (req) => req.method === 'OPTIONS' || process.env.NODE_ENV === 'test',
  // eslint-disable-next-line no-unused-vars
  handler: (req, res, next, options) => res.status(429).json({
    success: false,
    message: 'Demasiadas solicitudes; inténtalo de nuevo en unos minutos',
    code: 'RATE_LIMITED',
    scope: 'anuncios',
  }),
});

/**
 * Pure where-clause for "currently servable" ads. Exported so tests can
 * pin the date logic deterministically. `now` defaults to the real clock.
 */
function buildActiveWhere(now = new Date()) {
  return {
    active: true,
    [Op.and]: [
      { [Op.or]: [{ startAt: null }, { startAt: { [Op.lte]: now } }] },
      { [Op.or]: [{ endAt: null }, { endAt: { [Op.gte]: now } }] },
    ],
  };
}

function parseBoundedLimit(raw, { def, max, label }) {
  if (raw === undefined) return def;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > max) {
    const error = new Error(`${label} debe ser un entero entre 1 y ${max}`);
    error.status = 400;
    throw error;
  }
  return value;
}

function createAnunciosRoutes() {
  const router = express.Router();
  const repository = new CrudRepository(models.Anuncio);

  router.get('/activos', activosLimiter, async (req, res, next) => {
    try {
      const limit = parseBoundedLimit(req.query.limit,
        { def: PUBLIC_DEFAULT_LIMIT, max: PUBLIC_MAX_LIMIT, label: 'limit' });
      const { placement } = req.query;
      if (placement !== undefined && !PLACEMENTS.includes(placement)) {
        return res.status(400).json({
          success: false,
          message: `placement debe ser uno de: ${PLACEMENTS.join(', ')}`,
        });
      }
      const where = buildActiveWhere();
      if (placement !== undefined) where.placement = placement;
      const records = await repository.findAll({
        where,
        order: [['createdAt', 'DESC'], ['id', 'DESC']],
        limit,
      });
      return res.json({
        success: true,
        data: records.map(serializeAnuncioPublico),
        message: 'Consulta exitosa',
      });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/', requireAdsAdmin, async (req, res, next) => {
    try {
      const limit = parseBoundedLimit(req.query.limit,
        { def: ADMIN_DEFAULT_LIMIT, max: ADMIN_MAX_LIMIT, label: 'limit' });
      const page = parseBoundedLimit(req.query.page, { def: 1, max: 10000, label: 'page' });
      const records = await repository.findAll({
        order: [['createdAt', 'DESC'], ['id', 'DESC']],
        limit,
        offset: (page - 1) * limit,
      });
      return res.json({ success: true, data: records, message: 'Consulta exitosa' });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/:id', requireAdsAdmin, async (req, res, next) => {
    try {
      const record = await repository.findById(req.params.id);
      if (!record) return res.status(404).json({ success: false, message: 'Anuncio no encontrado' });
      return res.json({ success: true, data: record, message: 'Consulta exitosa' });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/', requireAdsAdmin, async (req, res, next) => {
    try {
      const { errors, value } = validateAnuncioInput(req.body);
      if (errors) {
        return res.status(400).json({
          success: false,
          message: errors.join('; '),
          invalid_params: errors,
        });
      }
      const record = await repository.create(value);
      return res.status(201).json({ success: true, data: record, message: 'Anuncio creado' });
    } catch (error) {
      return next(error);
    }
  });

  router.patch('/:id', requireAdsAdmin, async (req, res, next) => {
    try {
      const { errors, value } = validateAnuncioInput(req.body, { isUpdate: true });
      if (errors) {
        return res.status(400).json({
          success: false,
          message: errors.join('; '),
          invalid_params: errors,
        });
      }
      if (Object.keys(value).length === 0) {
        return res.status(400).json({ success: false, message: 'No hay campos válidos para actualizar' });
      }
      const record = await repository.updateById(req.params.id, value);
      if (!record) return res.status(404).json({ success: false, message: 'Anuncio no encontrado' });
      return res.json({ success: true, data: record, message: 'Anuncio actualizado' });
    } catch (error) {
      return next(error);
    }
  });

  router.delete('/:id', requireAdsAdmin, async (req, res, next) => {
    try {
      const deleted = await repository.deleteById(req.params.id);
      if (!deleted) return res.status(404).json({ success: false, message: 'Anuncio no encontrado' });
      return res.status(204).send();
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

module.exports = createAnunciosRoutes;
module.exports.buildActiveWhere = buildActiveWhere;
module.exports.PUBLIC_DEFAULT_LIMIT = PUBLIC_DEFAULT_LIMIT;
module.exports.PUBLIC_MAX_LIMIT = PUBLIC_MAX_LIMIT;
module.exports.ADMIN_DEFAULT_LIMIT = ADMIN_DEFAULT_LIMIT;
module.exports.ADMIN_MAX_LIMIT = ADMIN_MAX_LIMIT;
