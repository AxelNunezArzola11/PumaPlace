/**
 * End-to-end HTTP CORS & order-return security tests.
 * Covers preflight OPTIONS, GET /api/ordenes/:id, authentication/ownership checks,
 * unauthorized origins, application errors, rate-limit 429 responses, and
 * allowed methods/headers against the production frontend origin.
 */
process.env.NODE_ENV = 'production';
process.env.FRONTEND_URL = 'https://puma-place-web.onrender.com';
process.env.JWT_SECRET = 'test-only-jwt-secret';
process.env.DB_HOST = process.env.DB_HOST || 'localhost';
process.env.DB_USER = process.env.DB_USER || 'test';
process.env.DB_PASSWORD = process.env.DB_PASSWORD || 'test';
process.env.DB_NAME = process.env.DB_NAME || 'test';

const express = require('express');
const cors = require('cors');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { app } = require('../../index');
const { buildCorsOptions, PRODUCTION_FRONTEND_ORIGIN } = require('../../config/cors');
const { createLimiters } = require('../../middlewares/rateLimit');
const createApiRoutes = require('../api');
const EventBus = require('../../domain/events/EventBus');
const UsuarioRepository = require('../../infrastructure/repositories/UsuarioRepository');
const OrdenRepository = require('../../infrastructure/repositories/OrdenRepository');
const models = require('../../infrastructure/models');

const JWT_SECRET = 'test-only-jwt-secret';
const PROD_ORIGIN = PRODUCTION_FRONTEND_ORIGIN;
const EVIL_ORIGIN = 'https://evil.example';

const tokenFor = (sub) => jwt.sign({ sub }, JWT_SECRET);
const authAs = (sub) => ({ Authorization: `Bearer ${tokenFor(sub)}` });

describe('Production CORS & /api/ordenes/:id return flow', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    process.env = {
      ...OLD_ENV,
      NODE_ENV: 'production',
      FRONTEND_URL: PROD_ORIGIN,
      JWT_SECRET,
    };
  });

  afterEach(() => {
    process.env = OLD_ENV;
    jest.restoreAllMocks();
  });

  it('1 & 9. Handles OPTIONS preflight from the production frontend origin with allowed methods & headers', async () => {
    const res = await request(app)
      .options('/api/ordenes/324565')
      .set('Origin', PROD_ORIGIN)
      .set('Access-Control-Request-Method', 'GET')
      .set('Access-Control-Request-Headers', 'authorization,content-type');

    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe(PROD_ORIGIN);
    expect(res.headers['access-control-allow-origin']).not.toBe('*');
    expect(res.headers['access-control-allow-credentials']).toBe('true');
    expect(res.headers['access-control-allow-methods']).toBe('GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS');
    expect(res.headers['access-control-allow-headers']).toBe('Content-Type,Authorization,Accept,X-Requested-With');
    expect(res.headers.vary).toContain('Origin');
  });

  it('2 & 4. Includes CORS headers on actual GET /api/ordenes/:id for authenticated owner', async () => {
    jest.spyOn(UsuarioRepository.prototype, 'findById')
      .mockResolvedValue({ id: 1, rol: 'comprador', plan: 'free' });
    jest.spyOn(OrdenRepository.prototype, 'findById')
      .mockResolvedValue({
        id: 324565,
        compradorId: 1,
        estado: 'pagada',
        lineas: [{ productoId: 10, cantidad: 1, precioUnitario: 100 }],
      });
    jest.spyOn(models.Producto, 'findAll').mockResolvedValue([]);

    const res = await request(app)
      .get('/api/ordenes/324565')
      .set('Origin', PROD_ORIGIN)
      .set(authAs(1));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({ id: 324565, estado: 'pagada' });
    expect(res.headers['access-control-allow-origin']).toBe(PROD_ORIGIN);
    expect(res.headers['access-control-allow-origin']).not.toBe('*');
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });

  it('3. Preserves 401 authentication failure with CORS headers when unauthenticated', async () => {
    const res = await request(app)
      .get('/api/ordenes/324565')
      .set('Origin', PROD_ORIGIN);

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ success: false, message: 'Se requiere autenticación' });
    expect(res.headers['access-control-allow-origin']).toBe(PROD_ORIGIN);
  });

  it('5. Preserves 403 ownership check with CORS headers when accessing another user’s order', async () => {
    jest.spyOn(UsuarioRepository.prototype, 'findById')
      .mockResolvedValue({ id: 2, rol: 'comprador', plan: 'free' });
    jest.spyOn(OrdenRepository.prototype, 'findById')
      .mockResolvedValue({
        id: 324565,
        compradorId: 1,
        estado: 'pagada',
        lineas: [{ productoId: 10, cantidad: 1, precioUnitario: 100 }],
      });
    jest.spyOn(models.Producto, 'findAll').mockResolvedValue([{ id: 10, vendedorId: 99 }]);

    const res = await request(app)
      .get('/api/ordenes/324565')
      .set('Origin', PROD_ORIGIN)
      .set(authAs(2));

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ success: false, message: 'No tienes acceso a esta orden' });
    expect(res.headers['access-control-allow-origin']).toBe(PROD_ORIGIN);
  });

  it('6. Rejects requests and preflights from an unauthorized origin without Access-Control-Allow-Origin', async () => {
    const preflight = await request(app)
      .options('/api/ordenes/324565')
      .set('Origin', EVIL_ORIGIN)
      .set('Access-Control-Request-Method', 'GET');

    expect(preflight.status).toBe(403);
    expect(preflight.headers['access-control-allow-origin']).toBeUndefined();

    const actual = await request(app)
      .get('/api/ordenes/324565')
      .set('Origin', EVIL_ORIGIN)
      .set(authAs(1));

    expect(actual.status).toBe(403);
    expect(actual.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('7. Includes CORS headers on 404 and 500/application error responses', async () => {
    jest.spyOn(UsuarioRepository.prototype, 'findById')
      .mockResolvedValue({ id: 1, rol: 'comprador', plan: 'free' });
    const findOrder = jest.spyOn(OrdenRepository.prototype, 'findById');

    findOrder.mockResolvedValueOnce(null);
    const notFoundRes = await request(app)
      .get('/api/ordenes/999999')
      .set('Origin', PROD_ORIGIN)
      .set(authAs(1));

    expect(notFoundRes.status).toBe(404);
    expect(notFoundRes.headers['access-control-allow-origin']).toBe(PROD_ORIGIN);

    const dbError = new Error('Error inesperado en base de datos');
    dbError.status = 500;
    findOrder.mockRejectedValueOnce(dbError);
    const serverErrorRes = await request(app)
      .get('/api/ordenes/324565')
      .set('Origin', PROD_ORIGIN)
      .set(authAs(1));

    expect(serverErrorRes.status).toBe(500);
    expect(serverErrorRes.headers['access-control-allow-origin']).toBe(PROD_ORIGIN);
  });

  it('8. Includes CORS headers on 429 rate-limit responses and does not count OPTIONS preflights', async () => {
    const limitedApp = express();
    const corsMiddleware = cors(buildCorsOptions({
      NODE_ENV: 'production',
      FRONTEND_URL: PROD_ORIGIN,
    }));
    limitedApp.use(corsMiddleware);
    limitedApp.options('*', corsMiddleware);
    limitedApp.use(express.json());

    const { apiLimiter } = createLimiters({
      windowMs: 60000,
      generalMax: 1,
      authMax: 1,
      registerMax: 1,
      preferenciaMax: 1,
    });
    limitedApp.use('/api', apiLimiter);
    limitedApp.use('/api', createApiRoutes({ eventBus: new EventBus() }));

    jest.spyOn(UsuarioRepository.prototype, 'findById')
      .mockResolvedValue({ id: 1, rol: 'comprador', plan: 'free' });
    jest.spyOn(OrdenRepository.prototype, 'findById')
      .mockResolvedValue({ id: 324565, compradorId: 1, estado: 'pendiente', lineas: [] });
    jest.spyOn(models.Producto, 'findAll').mockResolvedValue([]);

    // OPTIONS preflight must succeed and must NOT consume the 1-request quota.
    const preflight = await request(limitedApp)
      .options('/api/ordenes/324565')
      .set('Origin', PROD_ORIGIN)
      .set('Access-Control-Request-Method', 'GET')
      .set('Access-Control-Request-Headers', 'authorization');
    expect(preflight.status).toBe(204);
    expect(preflight.headers['access-control-allow-origin']).toBe(PROD_ORIGIN);

    const first = await request(limitedApp)
      .get('/api/ordenes/324565')
      .set('Origin', PROD_ORIGIN)
      .set(authAs(1));
    expect(first.status).toBe(200);
    expect(first.headers['access-control-allow-origin']).toBe(PROD_ORIGIN);

    const rateLimited = await request(limitedApp)
      .get('/api/ordenes/324565')
      .set('Origin', PROD_ORIGIN)
      .set(authAs(1));
    expect(rateLimited.status).toBe(429);
    expect(rateLimited.body).toMatchObject({ success: false, code: 'RATE_LIMITED' });
    expect(rateLimited.headers['access-control-allow-origin']).toBe(PROD_ORIGIN);
    expect(rateLimited.headers['access-control-allow-credentials']).toBe('true');
  });
});
