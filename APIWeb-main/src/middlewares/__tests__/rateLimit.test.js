const express = require('express');
const request = require('supertest');
const { createLimiters } = require('../rateLimit');

const tiny = {
  windowMs: 60000, generalMax: 100, authMax: 2, registerMax: 2, preferenciaMax: 2,
};

function testApp(config = tiny) {
  const app = express();
  // Same mount order as src/index.js: strict paths first, then general /api.
  const { apiLimiter, loginLimiter } = createLimiters(config);
  app.use('/api/auth/login', loginLimiter);
  app.use('/api', apiLimiter);
  app.post('/api/auth/login', (req, res) => res.json({ ok: true }));
  app.post('/api/pagos/webhook', (req, res) => res.json({ ok: true }));
  app.get('/api/ping', (req, res) => res.json({ ok: true }));
  app.get('/health', (req, res) => res.json({ status: 'ok' }));
  return app;
}

describe('rate limiting', () => {
  it('lets requests below the limit through', async () => {
    const app = testApp();
    await request(app).get('/api/ping').expect(200);
    await request(app).get('/api/ping').expect(200);
  });

  it('answers 429 with JSON body and Retry-After above the limit', async () => {
    const app = testApp();
    await request(app).post('/api/auth/login').expect(200);
    await request(app).post('/api/auth/login').expect(200);
    const limited = await request(app).post('/api/auth/login').expect(429);

    expect(limited.body).toMatchObject({ success: false, code: 'RATE_LIMITED' });
    expect(limited.headers['retry-after']).toBeDefined();
    expect(limited.headers.ratelimit).toMatch(/limit=2/);
  });

  it('trips the strict login limit while general traffic still flows', async () => {
    const app = testApp();
    await request(app).post('/api/auth/login').expect(200);
    await request(app).post('/api/auth/login').expect(200);
    await request(app).post('/api/auth/login').expect(429);
    await request(app).get('/api/ping').expect(200);
  });

  it('never counts Mercado Pago webhook deliveries', async () => {
    const app = testApp({ ...tiny, generalMax: 1 });
    await request(app).get('/api/ping').expect(200);
    await request(app).get('/api/ping').expect(429);
    // Webhook excluded even though the general bucket is exhausted.
    await request(app).post('/api/pagos/webhook').expect(200);
    await request(app).post('/api/pagos/webhook').expect(200);
    await request(app).post('/api/pagos/webhook?type=payment').expect(200);
  });

  it('never counts OPTIONS preflights', async () => {
    const app = testApp({ ...tiny, generalMax: 1 });
    // 200 via Express automatic OPTIONS handling (cors answers preflights
    // in production); the point is the request consumed no quota.
    await request(app).options('/api/ping').expect(200);
    await request(app).get('/api/ping').expect(200);
    await request(app).get('/api/ping').expect(429);
  });

  it('ignores spoofed X-Forwarded-For without proxy trust', async () => {
    const app = testApp({ ...tiny, generalMax: 1 });
    await request(app).get('/api/ping').set('X-Forwarded-For', '1.2.3.4').expect(200);
    // A different spoofed header hits the SAME socket-IP bucket: not trusted.
    await request(app).get('/api/ping').set('X-Forwarded-For', '5.6.7.8').expect(429);
  });
});

describe('production rate-limit wiring (src/index.js)', () => {
  const OLD_ENV = process.env;

  beforeAll(() => {
    process.env = { ...OLD_ENV, NODE_ENV: 'test', JWT_SECRET: 'test-only-jwt-secret' };
  });

  afterAll(() => {
    process.env = OLD_ENV;
  });

  it('trusts exactly one proxy hop (Render), never arbitrary headers', () => {
    // eslint-disable-next-line global-require
    const { app } = require('../../index');
    expect(app.get('trust proxy')).toBe(1);
  });

  it('keeps /health outside every limiter', async () => {
    // eslint-disable-next-line global-require
    const { app } = require('../../index');
    await request(app).get('/health').expect(200);
    await request(app).get('/health').expect(200);
    await request(app).get('/health').expect(200);
  });
});
