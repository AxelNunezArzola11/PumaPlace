const express = require('express');
const { auth, requireRole } = require('../middlewares/auth');
const { createResourceController } = require('../controllers/resourceController');
const validateBody = require('../middlewares/validateBody');

function createResourceRoutes({
  repository,
  createUseCase,
  createFields,
  updateFields,
  role,
  mapCreateBody,
  requiredFields = [],
  serialize,
  authMiddleware = null,
  validateCreate = [],
  validateUpdate = [],
}) {
  const router = express.Router();
  const requireAuth = authMiddleware || auth();
  const effectiveCreateUseCase = createUseCase
    ? { execute: (body, req) => createUseCase.execute(mapCreateBody ? mapCreateBody(body, req) : body) }
    : null;
  const controller = createResourceController({
    repository,
    createUseCase: effectiveCreateUseCase,
    createFields,
    updateFields,
    serialize,
  });
  router.get('/', controller.list);
  router.get('/:id', controller.get);
  if (createUseCase || createFields?.length) {
    const createRoute = role
      ? [requireAuth, requireRole(role), validateBody(requiredFields), ...validateCreate, controller.create]
      : [requireAuth, validateBody(requiredFields), ...validateCreate, controller.create];
    router.post('/', ...createRoute);
  }
  if (updateFields?.length) {
    router.patch('/:id', requireAuth, ...validateUpdate, controller.update);
  }
  router.delete('/:id', requireAuth, controller.remove);
  return router;
}

module.exports = createResourceRoutes;
