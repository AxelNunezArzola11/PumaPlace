const express = require('express');
const { auth, requireRole } = require('../middlewares/auth');
const { createResourceController } = require('../controllers/resourceController');
const validateBody = require('../middlewares/validateBody');

function createResourceRoutes({
  repository, createUseCase, createFields, updateFields, role, mapCreateBody, requiredFields = [], serialize,
}) {
  const router = express.Router();
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
      ? [auth(), requireRole(role), validateBody(requiredFields), controller.create]
      : [auth(), validateBody(requiredFields), controller.create];
    router.post('/', ...createRoute);
  }
  if (updateFields?.length) router.patch('/:id', auth(), controller.update);
  router.delete('/:id', auth(), controller.remove);
  return router;
}

module.exports = createResourceRoutes;
