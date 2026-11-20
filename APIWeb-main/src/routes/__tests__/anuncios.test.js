/**
 * Advertisement API tests (no database).
 *
 * Covers the public endpoint contract (only active, in-window ads; no
 * administrative fields; bounded limits), the validity-window logic, URL
 * validation, and the ADS_ADMIN_TOKEN authorization on every management
 * operation — including proof that ordinary user JWTs are rejected.
 */
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { Op } = require('sequelize');
const createAnunciosRoutes = require('../anuncios');
const { buildActiveWhere } = require('../anuncios');
const CrudRepository = require('../../infrastructure/repositories/CrudRepository');
const {
  isAllowedUrl,
  validateAnuncioInput,
  serializeAnuncioPublico,
} = require('../../domain/anuncios/anuncioValidation');

const ADS_TOKEN = 'test-ads-admin-token';
const JWT_SECRET = 'test-only-jwt-secret';
const adminAs = (token) => ({ Authorization: `Bearer ${token}` });
const userJwt = () => jwt.sign({ sub: 1, rol: 'dual', plan: 'premium' }, JWT_SECRET);

const VALID_AD = Object.freeze({
  title: 'Promo estudiantes',
  description: 'Descuento con credencial vigente',
  imageUrl: 'https://example.com/img.png',
  targetUrl: 'https://example.com/oferta',
  advertiser: 'Tienda X',
  placement: 'catalogo',
  active: true,
});

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/anuncios', createAnunciosRoutes());
  // eslint-disable-next-line no-unused-vars
  app.use((error, req, res, next) => {
    res.status(error.status || 400).json({ success: false, message: error.message });
  });
  return app;
}

describe('GET /api/anuncios/activos (public endpoint)', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    process.env = { ...OLD_ENV, NODE_ENV: 'test' };
  });

  afterEach(() => {
    process.env = OLD_ENV;
    jest.restoreAllMocks();
  });

  it('needs no authentication and returns only the public projection', async () => {
    jest.spyOn(CrudRepository.prototype, 'findAll').mockResolvedValue([
      {
        id: 3, title: 'A', description: 'D', imageUrl: 'https://a.img/x.png',
        targetUrl: 'https://a.example/o', advertiser: 'Adv', placement: 'catalogo',
        active: true, startAt: new Date('2020-01-01'), endAt: null,
        createdAt: new Date('2020-01-01'), updatedAt: new Date('2020-01-02'),
      },
    ]);
    const app = buildApp();
    const response = await request(app).get('/api/anuncios/activos');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toEqual([{
      id: 3, title: 'A', description: 'D', imageUrl: 'https://a.img/x.png',
      targetUrl: 'https://a.example/o', advertiser: 'Adv', placement: 'catalogo',
    }]);
    // Administrative/scheduling fields never leave the public endpoint.
    for (const ad of response.body.data) {
      expect(ad).not.toHaveProperty('active');
      expect(ad).not.toHaveProperty('startAt');
      expect(ad).not.toHaveProperty('endAt');
      expect(ad).not.toHaveProperty('createdAt');
      expect(ad).not.toHaveProperty('updatedAt');
    }
  });

  it('queries only active ads inside their validity window', async () => {
    const findAll = jest.spyOn(CrudRepository.prototype, 'findAll').mockResolvedValue([]);
    const app = buildApp();
    await request(app).get('/api/anuncios/activos');

    expect(findAll).toHaveBeenCalledTimes(1);
    const options = findAll.mock.calls[0][0];
    expect(options.where.active).toBe(true);
    expect(options.limit).toBe(10);
    const and = options.where[Op.and];
    expect(and).toHaveLength(2);
    expect(and[0][Op.or]).toContainEqual({ startAt: null });
    expect(and[1][Op.or]).toContainEqual({ endAt: null });
    const lte = and[0][Op.or].find((clause) => clause.startAt && clause.startAt[Op.lte]);
    const gte = and[1][Op.or].find((clause) => clause.endAt && clause.endAt[Op.gte]);
    expect(lte.startAt[Op.lte]).toBeInstanceOf(Date);
    expect(gte.endAt[Op.gte]).toBeInstanceOf(Date);
  });

  it('returns an empty list (never fake ads) when nothing is active', async () => {
    jest.spyOn(CrudRepository.prototype, 'findAll').mockResolvedValue([]);
    const app = buildApp();
    const response = await request(app).get('/api/anuncios/activos');

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([]);
  });

  it('applies a valid placement filter and bounded limit', async () => {
    const findAll = jest.spyOn(CrudRepository.prototype, 'findAll').mockResolvedValue([]);
    const app = buildApp();
    const response = await request(app).get('/api/anuncios/activos?placement=banner&limit=5');

    expect(response.status).toBe(200);
    const options = findAll.mock.calls[0][0];
    expect(options.where.placement).toBe('banner');
    expect(options.where.active).toBe(true);
    expect(options.limit).toBe(5);
  });

  it.each([['0'], ['51'], ['999'], ['abc'], ['-3']])('rejects out-of-range limit=%s', async (limit) => {
    const findAll = jest.spyOn(CrudRepository.prototype, 'findAll');
    const app = buildApp();
    const response = await request(app).get(`/api/anuncios/activos?limit=${limit}`);

    expect(response.status).toBe(400);
    expect(findAll).not.toHaveBeenCalled();
  });

  it('rejects an unknown placement', async () => {
    const findAll = jest.spyOn(CrudRepository.prototype, 'findAll');
    const app = buildApp();
    const response = await request(app).get('/api/anuncios/activos?placement=popup');

    expect(response.status).toBe(400);
    expect(findAll).not.toHaveBeenCalled();
  });
});

describe('buildActiveWhere (validity window)', () => {
  it('pins both bounds to the provided clock', () => {
    const now = new Date('2026-06-15T12:00:00.000Z');
    const where = buildActiveWhere(now);

    expect(where.active).toBe(true);
    const and = where[Op.and];
    const lte = and[0][Op.or].find((clause) => clause.startAt && clause.startAt[Op.lte]);
    const gte = and[1][Op.or].find((clause) => clause.endAt && clause.endAt[Op.gte]);
    expect(lte.startAt[Op.lte]).toEqual(now);
    expect(gte.endAt[Op.gte]).toEqual(now);
  });

  it('defaults to the real clock', () => {
    const before = Date.now();
    const where = buildActiveWhere();
    const lte = where[Op.and][0][Op.or]
      .find((clause) => clause.startAt && clause.startAt[Op.lte]).startAt[Op.lte];
    expect(lte.getTime()).toBeGreaterThanOrEqual(before);
    expect(lte.getTime()).toBeLessThanOrEqual(Date.now());
  });
});

describe('URL validation', () => {
  it.each([
    ['https://example.com/img.png'],
    ['https://sub.example.com:8443/a/b?x=1#y'],
  ])('accepts %s everywhere', (url) => {
    expect(isAllowedUrl(url, { NODE_ENV: 'production' })).toBe(true);
    expect(isAllowedUrl(url, { NODE_ENV: 'test' })).toBe(true);
  });

  it.each([
    ['not-a-url'],
    [''],
    ['   '],
    ['ftp://example.com/x.png'],
    ['javascript:alert(1)'],
    ['http://example.com/x.png'],
    ['https://user:pass@example.com/x.png'],
    ['http://user@example.com/x.png'],
    [null],
    [undefined],
    [123],
  ])('rejects %s in every environment', (url) => {
    expect(isAllowedUrl(url, { NODE_ENV: 'production' })).toBe(false);
    expect(isAllowedUrl(url, { NODE_ENV: 'test' })).toBe(false);
  });

  it('accepts localhost http only outside production', () => {
    for (const url of ['http://localhost:3000/x.png', 'http://127.0.0.1/x.png', 'http://[::1]/x.png']) {
      expect(isAllowedUrl(url, { NODE_ENV: 'test' })).toBe(true);
      expect(isAllowedUrl(url, { NODE_ENV: 'development' })).toBe(true);
      expect(isAllowedUrl(url, { NODE_ENV: 'production' })).toBe(false);
    }
  });

  it('rejects overlong URLs', () => {
    const long = `https://example.com/${'a'.repeat(2100)}`;
    expect(isAllowedUrl(long, { NODE_ENV: 'test' })).toBe(false);
  });
});

describe('validateAnuncioInput', () => {
  const DEV = { NODE_ENV: 'test' };

  it('accepts a complete valid payload and trims text', () => {
    const { errors, value } = validateAnuncioInput(
      { ...VALID_AD, title: '  Promo  ', description: '  D  ' }, {}, DEV,
    );
    expect(errors).toBeUndefined();
    expect(value).toMatchObject({ title: 'Promo', description: 'D', placement: 'catalogo' });
  });

  it('requires title, advertiser, imageUrl and targetUrl on create', () => {
    const { errors } = validateAnuncioInput({}, {}, DEV);
    expect(errors.join(';')).toMatch(/título/);
    expect(errors.join(';')).toMatch(/anunciante/);
    expect(errors.join(';')).toMatch(/imagen/);
    expect(errors.join(';')).toMatch(/destino/);
  });

  it('allows partial payloads on update', () => {
    const { errors, value } = validateAnuncioInput({ active: false }, { isUpdate: true }, DEV);
    expect(errors).toBeUndefined();
    expect(value).toEqual({ active: false });
  });

  it('rejects startAt after endAt and unparsable dates', () => {
    const reversed = validateAnuncioInput(
      { ...VALID_AD, startAt: '2026-02-01', endAt: '2026-01-01' }, {}, DEV,
    );
    expect(reversed.errors.join(';')).toMatch(/startAt/);
    const garbage = validateAnuncioInput({ ...VALID_AD, startAt: 'ayer' }, {}, DEV);
    expect(garbage.errors.join(';')).toMatch(/startAt/);
  });

  it('rejects bad placement, non-boolean active, and overlong text', () => {
    const { errors } = validateAnuncioInput(
      { ...VALID_AD, placement: 'popup', active: 'yes', title: 'x'.repeat(151) }, {}, DEV,
    );
    expect(errors.join(';')).toMatch(/placement/);
    expect(errors.join(';')).toMatch(/active/);
    expect(errors.join(';')).toMatch(/título/);
  });
});

describe('serializeAnuncioPublico', () => {
  it('keeps only storefront fields', () => {
    expect(serializeAnuncioPublico({
      id: 1, title: 'T', description: null, imageUrl: 'i', targetUrl: 't',
      advertiser: 'A', placement: 'catalogo', active: true,
      startAt: new Date(), endAt: new Date(), createdAt: new Date(), updatedAt: new Date(),
    })).toEqual({
      id: 1, title: 'T', description: null, imageUrl: 'i', targetUrl: 't',
      advertiser: 'A', placement: 'catalogo',
    });
  });
});

describe('ad management authorization', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    process.env = { ...OLD_ENV, NODE_ENV: 'test', ADS_ADMIN_TOKEN: ADS_TOKEN };
  });

  afterEach(() => {
    process.env = OLD_ENV;
    jest.restoreAllMocks();
  });

  it.each([
    ['get', '/api/anuncios'],
    ['get', '/api/anuncios/1'],
    ['post', '/api/anuncios'],
    ['patch', '/api/anuncios/1'],
    ['delete', '/api/anuncios/1'],
  ])('%s %s rejects a missing credential', async (method, url) => {
    const app = buildApp();
    const response = await request(app)[method](url).send({ ...VALID_AD });
    expect(response.status).toBe(401);
  });

  it.each([
    ['get', '/api/anuncios'],
    ['get', '/api/anuncios/1'],
    ['post', '/api/anuncios'],
    ['patch', '/api/anuncios/1'],
    ['delete', '/api/anuncios/1'],
  ])('%s %s rejects a wrong credential without touching the database', async (method, url) => {
    const findAll = jest.spyOn(CrudRepository.prototype, 'findAll');
    const findById = jest.spyOn(CrudRepository.prototype, 'findById');
    const create = jest.spyOn(CrudRepository.prototype, 'create');
    const updateById = jest.spyOn(CrudRepository.prototype, 'updateById');
    const deleteById = jest.spyOn(CrudRepository.prototype, 'deleteById');
    const app = buildApp();
    const response = await request(app)[method](url).set(adminAs('wrong-token')).send({ ...VALID_AD });

    expect(response.status).toBe(401);
    expect(response.body.code).toBe('INVALID_ADS_ADMIN_TOKEN');
    expect(findAll).not.toHaveBeenCalled();
    expect(findById).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(updateById).not.toHaveBeenCalled();
    expect(deleteById).not.toHaveBeenCalled();
  });

  it('rejects ordinary user JWTs (buyer, seller, dual): no role escalation', async () => {
    const create = jest.spyOn(CrudRepository.prototype, 'create');
    const app = buildApp();
    for (const rol of ['comprador', 'vendedor', 'dual']) {
      const token = jwt.sign({ sub: 7, rol, plan: 'premium' }, JWT_SECRET);
      const response = await request(app)
        .post('/api/anuncios').set(adminAs(token)).send({ ...VALID_AD });
      expect(response.status).toBe(401);
    }
    expect(userJwt()).toBeTruthy();
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects the maintenance token: ad admin is a separate credential', async () => {
    process.env.MAINTENANCE_TOKEN = 'maintenance-token-value';
    const findAll = jest.spyOn(CrudRepository.prototype, 'findAll');
    const app = buildApp();
    const response = await request(app).get('/api/anuncios').set(adminAs('maintenance-token-value'));

    expect(response.status).toBe(401);
    expect(findAll).not.toHaveBeenCalled();
  });

  it.each([
    ['get', '/api/anuncios'],
    ['post', '/api/anuncios'],
    ['patch', '/api/anuncios/1'],
    ['delete', '/api/anuncios/1'],
  ])('%s %s fails closed (503) when the server token is missing', async (method, url) => {
    delete process.env.ADS_ADMIN_TOKEN;
    const create = jest.spyOn(CrudRepository.prototype, 'create');
    const app = buildApp();
    const response = await request(app)[method](url).set(adminAs(ADS_TOKEN)).send({ ...VALID_AD });

    expect(response.status).toBe(503);
    expect(response.body.code).toBe('ADS_ADMIN_TOKEN_MISSING');
    expect(create).not.toHaveBeenCalled();
  });
});

describe('ad management behavior (authorized)', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    process.env = { ...OLD_ENV, NODE_ENV: 'test', ADS_ADMIN_TOKEN: ADS_TOKEN };
  });

  afterEach(() => {
    process.env = OLD_ENV;
    jest.restoreAllMocks();
  });

  it('lists every ad with default pagination', async () => {
    const findAll = jest.spyOn(CrudRepository.prototype, 'findAll').mockResolvedValue([{ id: 1 }]);
    const app = buildApp();
    const response = await request(app).get('/api/anuncios').set(adminAs(ADS_TOKEN));

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([{ id: 1 }]);
    expect(findAll).toHaveBeenCalledWith({ order: [['createdAt', 'DESC'], ['id', 'DESC']], limit: 20, offset: 0 });
  });

  it('paginates the admin list and bounds limit/page', async () => {
    const findAll = jest.spyOn(CrudRepository.prototype, 'findAll').mockResolvedValue([]);
    const app = buildApp();
    const ok = await request(app).get('/api/anuncios?page=3&limit=5').set(adminAs(ADS_TOKEN));
    expect(ok.status).toBe(200);
    expect(findAll).toHaveBeenCalledWith({ order: [['createdAt', 'DESC'], ['id', 'DESC']], limit: 5, offset: 10 });

    const tooBig = await request(app).get('/api/anuncios?limit=101').set(adminAs(ADS_TOKEN));
    expect(tooBig.status).toBe(400);
    const badPage = await request(app).get('/api/anuncios?page=0').set(adminAs(ADS_TOKEN));
    expect(badPage.status).toBe(400);
  });

  it('reads one ad or 404', async () => {
    const findById = jest.spyOn(CrudRepository.prototype, 'findById');
    const app = buildApp();
    findById.mockResolvedValue({ id: 1, ...VALID_AD });
    const ok = await request(app).get('/api/anuncios/1').set(adminAs(ADS_TOKEN));
    expect(ok.status).toBe(200);

    findById.mockResolvedValue(null);
    const missing = await request(app).get('/api/anuncios/999').set(adminAs(ADS_TOKEN));
    expect(missing.status).toBe(404);
  });

  it('creates an ad with the sanitized payload and strips unknown fields', async () => {
    const create = jest.spyOn(CrudRepository.prototype, 'create')
      .mockImplementation(async (data) => ({ id: 9, ...data }));
    const app = buildApp();
    const response = await request(app)
      .post('/api/anuncios')
      .set(adminAs(ADS_TOKEN))
      .send({ ...VALID_AD, id: 999, createdAt: '2020-01-01', hacked: true });

    expect(response.status).toBe(201);
    expect(create).toHaveBeenCalledTimes(1);
    const persisted = create.mock.calls[0][0];
    expect(persisted).not.toHaveProperty('id');
    expect(persisted).not.toHaveProperty('createdAt');
    expect(persisted).not.toHaveProperty('hacked');
    expect(persisted).toMatchObject({ title: VALID_AD.title, placement: 'catalogo' });
  });

  it.each([
    ['missing title', { title: undefined }],
    ['blank advertiser', { advertiser: '  ' }],
    ['plain-text image URL', { imageUrl: 'http://example.com/x.png' }],
    ['non-URL image', { imageUrl: 'not-a-url' }],
    ['javascript target', { targetUrl: 'javascript:alert(1)' }],
    ['credentialed target', { targetUrl: 'https://user:pass@example.com/' }],
    ['bad placement', { placement: 'popup' }],
    ['non-boolean active', { active: 'yes' }],
    ['reversed dates', { startAt: '2026-02-01', endAt: '2026-01-01' }],
    ['garbage endAt', { endAt: 'someday' }],
  ])('rejects creation with %s', async (label, override) => {
    const create = jest.spyOn(CrudRepository.prototype, 'create');
    const app = buildApp();
    const body = { ...VALID_AD, ...override };
    if (override.title === undefined && label === 'missing title') delete body.title;
    const response = await request(app).post('/api/anuncios').set(adminAs(ADS_TOKEN)).send(body);

    expect(response.status).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });

  it('accepts localhost http image URLs in local development', async () => {
    const create = jest.spyOn(CrudRepository.prototype, 'create')
      .mockImplementation(async (data) => ({ id: 9, ...data }));
    const app = buildApp();
    const response = await request(app)
      .post('/api/anuncios')
      .set(adminAs(ADS_TOKEN))
      .send({ ...VALID_AD, imageUrl: 'http://localhost:3000/x.png' });

    expect(response.status).toBe(201);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ imageUrl: 'http://localhost:3000/x.png' }));
  });

  it('edits, activates, and deactivates through PATCH', async () => {
    const updateById = jest.spyOn(CrudRepository.prototype, 'updateById')
      .mockImplementation(async (id, data) => ({ id: Number(id), ...VALID_AD, ...data }));
    const app = buildApp();

    const edited = await request(app)
      .patch('/api/anuncios/4').set(adminAs(ADS_TOKEN)).send({ title: 'Nuevo título' });
    expect(edited.status).toBe(200);
    expect(updateById).toHaveBeenCalledWith('4', { title: 'Nuevo título' });

    const off = await request(app)
      .patch('/api/anuncios/4').set(adminAs(ADS_TOKEN)).send({ active: false });
    expect(off.status).toBe(200);
    expect(updateById).toHaveBeenCalledWith('4', { active: false });

    const on = await request(app)
      .patch('/api/anuncios/4').set(adminAs(ADS_TOKEN)).send({ active: true });
    expect(on.status).toBe(200);
    expect(updateById).toHaveBeenCalledWith('4', { active: true });
  });

  it('rejects empty and invalid PATCH payloads, and 404s unknown ids', async () => {
    const updateById = jest.spyOn(CrudRepository.prototype, 'updateById');
    const app = buildApp();

    const empty = await request(app).patch('/api/anuncios/4').set(adminAs(ADS_TOKEN)).send({});
    expect(empty.status).toBe(400);

    const bad = await request(app)
      .patch('/api/anuncios/4').set(adminAs(ADS_TOKEN)).send({ imageUrl: 'http://example.com/x.png' });
    expect(bad.status).toBe(400);
    expect(updateById).not.toHaveBeenCalled();

    updateById.mockResolvedValue(null);
    const missing = await request(app)
      .patch('/api/anuncios/999').set(adminAs(ADS_TOKEN)).send({ active: false });
    expect(missing.status).toBe(404);
  });

  it('deletes with 204 or 404', async () => {
    const deleteById = jest.spyOn(CrudRepository.prototype, 'deleteById');
    const app = buildApp();
    deleteById.mockResolvedValue(true);
    const ok = await request(app).delete('/api/anuncios/4').set(adminAs(ADS_TOKEN));
    expect(ok.status).toBe(204);

    deleteById.mockResolvedValue(false);
    const missing = await request(app).delete('/api/anuncios/999').set(adminAs(ADS_TOKEN));
    expect(missing.status).toBe(404);
  });
});
