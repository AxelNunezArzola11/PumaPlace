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
  listOptions,
  authMiddleware = null,
  publicRead = false,
  authorizeUpdate = null,
  authorizeDelete = null,
  authorizeGet = null,
  validateCreate = [],
  validateUpdate = [],
  // Deny-by-default: no DELETE route is registered unless the mount
  // explicitly opts in with `deletable: true` (plus an authorizeDelete
  // ownership check wherever ownership applies).
  deletable = false,
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
    listOptions,
    // Plain repository creates also honor mapCreateBody (see controller);
    // use-case mounts already applied it above via effectiveCreateUseCase.
    mapCreateBody: createUseCase ? null : mapCreateBody,
  });
  router.get('/', ...(publicRead ? [] : [requireAuth]), controller.list);
  router.get('/:id', ...(publicRead ? [] : [requireAuth]), ...(authorizeGet ? [authorizeGet] : []), controller.get);
  if (createUseCase || createFields?.length) {
    const createRoute = role
      ? [requireAuth, requireRole(role), validateBody(requiredFields), ...validateCreate, controller.create]
      : [requireAuth, validateBody(requiredFields), ...validateCreate, controller.create];
    router.post('/', ...createRoute);
  }
  if (updateFields?.length) {
    router.patch(
      '/:id',
      requireAuth,
      ...(authorizeUpdate ? [authorizeUpdate] : []),
      ...validateUpdate,
      controller.update,
    );
  }
  if (deletable) {
    router.delete(
      '/:id',
      requireAuth,
      ...(authorizeDelete ? [authorizeDelete] : []),
      controller.remove,
    );
  }
  return router;
}

module.exports = createResourceRoutes;
