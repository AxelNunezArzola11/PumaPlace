const express = require('express');
const createAuthController = require('../controllers/authController');

function createAuthRoutes(dependencies) {
  const router = express.Router();
  const controller = createAuthController(dependencies);
  router.post('/register', controller.register);
  router.post('/login', controller.login);
  return router;
}

module.exports = createAuthRoutes;
