/**
 * Payment-flow regression suite (TEST 1–15).
 *
 * Guards the core business rule: creating a preference, redirecting to
 * Mercado Pago, or returning to a success URL is NEVER a purchase. Only a
 * verified, approved payment confirmed server-side finalizes an order and
 * deducts inventory.
 *
 * Fully mocked: no database, no live Mercado Pago. The gateway is stubbed
 * per test (consultarPago = server-side re-query, crearPreferencia).
 *
 * Map:
 *  TEST 1  preference creation never confirms (success/failure/paid/expired)
 *  TEST 2  browser success redirect without webhook changes nothing
 *  TEST 3  fake unsigned webhook rejected
 *  TEST 4  invalid signature rejected without DB changes
 *  TEST 5  approved verified payment finalizes exactly once
 *  TEST 6  rejected payment releases, never confirms
 *  TEST 7  cancelled payment releases, never confirms
 *  TEST 8  expired payment (MP status + reservation TTL) releases
 *  TEST 9  duplicate approved webhook finalizes only once
 *  TEST 10 out-of-order webhooks never revert an approval
 *  TEST 11 amount mismatch rejected
 *  TEST 12 external-reference mismatch / unknown / missing rejected
 *  TEST 13 currency mismatch rejected
 *  TEST 14 concurrent checkouts cannot oversell
 *  TEST 15 seller authorization fix remains intact
 */
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const createApiRoutes = require('../api');
const EventBus = require('../../domain/events/EventBus');
const CrearOrden = require('../../use-cases/CrearOrden');
const ConfirmarPago = require('../../use-cases/ConfirmarPago');
const ExpirarReservasVencidas = require('../../use-cases/ExpirarReservasVencidas');
const ReciboTransaccion = require('../../domain/entities/ReciboTransaccion');
const UsuarioRepository = require('../../infrastructure/repositories/UsuarioRepository');
const ProductoRepository = require('../../infrastructure/repositories/ProductoRepository');
const InventarioRepository = require('../../infrastructure/repositories/InventarioRepository');
const CarritoRepository = require('../../infrastructure/repositories/CarritoRepository');
const OrdenRepository = require('../../infrastructure/repositories/OrdenRepository');
const PagoRepository = require('../../infrastructure/repositories/PagoRepository');
const ReciboTransaccionRepository = require('../../infrastructure/repositories/ReciboTransaccionRepository');
const models = require('../../infrastructure/models');
const {
  buildManifest,
  signManifest,
} = require('../../middlewares/verifyMercadoPagoSignature');

const SECRET = 'test-webhook-secret-value';
const JWT_SECRET = 'test-only-jwt-secret';
const tokenFor = (sub) => jwt.sign({ sub }, JWT_SECRET);
const authAs = (sub) => ({ Authorization: `Bearer ${tokenFor(sub)}` });

const freshDate = () => new Date().toISOString();
const expiredDate = () => new Date(Date.now() - 31 * 60 * 1000).toISOString();

// Total: 2 × 25.00 = 50.00, MXN.
const baseOrden = {
  id: 5,
  compradorId: 1,
  puntoEntrega: 'Biblioteca Central',
  descuento: 0,
  estado: 'pendiente',
  lineas: [{ productoId: 1, cantidad: 2, precioUnitario: 25 }],
};

const approvedPayment = {
  status: 'approved',
  transaction_amount: 50,
  currency_id: 'MXN',
  external_reference: '5',
};

function signedHeaders({ dataId = 'pay-123', requestId = 'req-abc' } = {}) {
  const ts = String(Math.floor(Date.now() / 1000));
  return {
    'x-request-id': requestId,
    'x-signature': `ts=${ts},v1=${signManifest(buildManifest({ dataId, requestId, ts }), SECRET)}`,
  };
}

function buildApp({ paymentGateway, runInTransaction } = {}) {
  const eventBus = new EventBus();
  const published = [];
  jest.spyOn(eventBus, 'publish').mockImplementation((name, payload) => {
    published.push([name, payload]);
  });
  const gateway = paymentGateway || { consultarPago: jest.fn(), crearPreferencia: jest.fn() };
  const runner = runInTransaction || jest.fn((work) => work({}));
  const app = express();
  app.use(express.json());
  app.use('/api', createApiRoutes({ eventBus, paymentGateway: gateway, runInTransaction: runner }));
  // Minimal error mapper mirroring src/index.js semantics for these paths.
  // eslint-disable-next-line no-unused-vars
  app.use((error, req, res, next) => {
    res.status(error.status || 400).json({ success: false, message: error.message });
  });
  return { app, eventBus, published, paymentGateway: gateway, runInTransaction: runner };
}

const OLD_ENV = process.env;

beforeEach(() => {
  process.env = { ...OLD_ENV, NODE_ENV: 'test', MP_WEBHOOK_SECRET: SECRET, JWT_SECRET };
});

afterEach(() => {
  process.env = OLD_ENV;
  jest.restoreAllMocks();
});

describe('TEST 1 — preference creation is never a purchase', () => {
  const pendingOrden = () => ({ ...baseOrden, createdAt: freshDate() });

  it('creates a preference without confirming the order or touching stock', async () => {
    jest.spyOn(UsuarioRepository.prototype, 'findById')
      .mockResolvedValue({ id: 1, rol: 'comprador', plan: 'free' });
    jest.spyOn(OrdenRepository.prototype, 'findById').mockResolvedValue(pendingOrden());
    const save = jest.spyOn(OrdenRepository.prototype, 'save')
      .mockImplementation(async (id, data) => ({ ...pendingOrden(), ...data }));
    const pagoCreate = jest.spyOn(PagoRepository.prototype, 'create');
    const commit = jest.spyOn(InventarioRepository.prototype, 'commitReservation').mockResolvedValue(true);
    const release = jest.spyOn(InventarioRepository.prototype, 'releaseReservation').mockResolvedValue(true);
    const crearPreferencia = jest.fn().mockResolvedValue({ id: 'pref-1', sandbox_init_point: 'https://checkout.test' });
    const { app } = buildApp({ paymentGateway: { consultarPago: jest.fn(), crearPreferencia } });

    const response = await request(app)
      .post('/api/pagos/preferencia')
      .set(authAs(1))
      .send({ ordenId: 5 });

    expect(response.status).toBe(201);
    expect(crearPreferencia).toHaveBeenCalledTimes(1);
    // PAYMENT_PENDING marker only — never pagada.
    expect(save).toHaveBeenCalledWith(5, { estado: 'procesando' });
    for (const call of save.mock.calls) {
      expect(call[1].estado).not.toBe('pagada');
    }
    expect(pagoCreate).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();
  });

  it('cancels and releases the reservation when preference creation fails', async () => {
    jest.spyOn(UsuarioRepository.prototype, 'findById')
      .mockResolvedValue({ id: 1, rol: 'comprador', plan: 'free' });
    jest.spyOn(OrdenRepository.prototype, 'findById').mockResolvedValue(pendingOrden());
    const save = jest.spyOn(OrdenRepository.prototype, 'save');
    const cancelIfOpen = jest.spyOn(OrdenRepository.prototype, 'cancelIfOpen').mockResolvedValue(true);
    const release = jest.spyOn(InventarioRepository.prototype, 'releaseReservation').mockResolvedValue(true);
    const pagoCreate = jest.spyOn(PagoRepository.prototype, 'create');
    const crearPreferencia = jest.fn().mockRejectedValue(new Error('MP down'));
    const { app, published } = buildApp({ paymentGateway: { consultarPago: jest.fn(), crearPreferencia } });

    const response = await request(app)
      .post('/api/pagos/preferencia')
      .set(authAs(1))
      .send({ ordenId: 5 });

    expect(crearPreferencia).toHaveBeenCalledTimes(1);
    expect(cancelIfOpen).toHaveBeenCalledWith(5);
    expect(save).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledWith(1, 2);
    expect(published).toContainEqual(
      [EventBus.EVENTS.ORDER_CANCELLED, expect.objectContaining({ stockReleased: true })],
    );
    expect(pagoCreate).not.toHaveBeenCalled();
    expect(response.status).toBe(400);
  });

  it('leaves a concurrently-approved order untouched when preference creation fails', async () => {
    jest.spyOn(UsuarioRepository.prototype, 'findById')
      .mockResolvedValue({ id: 1, rol: 'comprador', plan: 'free' });
    jest.spyOn(OrdenRepository.prototype, 'findById').mockResolvedValue(pendingOrden());
    const cancelIfOpen = jest.spyOn(OrdenRepository.prototype, 'cancelIfOpen').mockResolvedValue(false);
    const release = jest.spyOn(InventarioRepository.prototype, 'releaseReservation').mockResolvedValue(true);
    const crearPreferencia = jest.fn().mockRejectedValue(new Error('MP down'));
    const { app, published } = buildApp({ paymentGateway: { consultarPago: jest.fn(), crearPreferencia } });

    const response = await request(app)
      .post('/api/pagos/preferencia')
      .set(authAs(1))
      .send({ ordenId: 5 });

    expect(response.status).toBe(400);
    expect(cancelIfOpen).toHaveBeenCalledWith(5);
    expect(release).not.toHaveBeenCalled();
    expect(published.filter(([name]) => name === EventBus.EVENTS.ORDER_CANCELLED)).toHaveLength(0);
  });

  it('refuses a new preference for an already-paid order', async () => {
    jest.spyOn(UsuarioRepository.prototype, 'findById')
      .mockResolvedValue({ id: 1, rol: 'comprador', plan: 'free' });
    jest.spyOn(OrdenRepository.prototype, 'findById')
      .mockResolvedValue({ ...pendingOrden(), estado: 'pagada' });
    const save = jest.spyOn(OrdenRepository.prototype, 'save');
    const crearPreferencia = jest.fn();
    const { app } = buildApp({ paymentGateway: { consultarPago: jest.fn(), crearPreferencia } });

    const response = await request(app)
      .post('/api/pagos/preferencia')
      .set(authAs(1))
      .send({ ordenId: 5 });

    expect(response.status).toBe(422);
    expect(response.body.message).toMatch(/pagada/);
    expect(crearPreferencia).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it('expires abandoned reservations instead of selling them a preference', async () => {
    jest.spyOn(UsuarioRepository.prototype, 'findById')
      .mockResolvedValue({ id: 1, rol: 'comprador', plan: 'free' });
    jest.spyOn(OrdenRepository.prototype, 'findById')
      .mockResolvedValue({ ...pendingOrden(), createdAt: expiredDate() });
    const cancelIfOpen = jest.spyOn(OrdenRepository.prototype, 'cancelIfOpen').mockResolvedValue(true);
    const release = jest.spyOn(InventarioRepository.prototype, 'releaseReservation').mockResolvedValue(true);
    const crearPreferencia = jest.fn();
    const { app, published } = buildApp({ paymentGateway: { consultarPago: jest.fn(), crearPreferencia } });

    const response = await request(app)
      .post('/api/pagos/preferencia')
      .set(authAs(1))
      .send({ ordenId: 5 });

    expect(response.status).toBe(410);
    expect(response.body.message).toMatch(/expiró/);
    expect(crearPreferencia).not.toHaveBeenCalled();
    expect(cancelIfOpen).toHaveBeenCalledWith(5);
    expect(release).toHaveBeenCalledWith(1, 2);
    expect(published).toContainEqual(
      [EventBus.EVENTS.ORDER_CANCELLED, expect.objectContaining({ stockReleased: true })],
    );
  });
});

describe('TEST 2 — browser success redirect without webhook proves nothing', () => {
  it('leaves the order pending and stock untouched on read-only return polling', async () => {
    jest.spyOn(UsuarioRepository.prototype, 'findById')
      .mockResolvedValue({ id: 1, rol: 'comprador', plan: 'free' });
    jest.spyOn(OrdenRepository.prototype, 'findById')
      .mockResolvedValue({ ...baseOrden, createdAt: freshDate() });
    jest.spyOn(models.Producto, 'findAll').mockResolvedValue([]);
    const save = jest.spyOn(OrdenRepository.prototype, 'save');
    const pagoCreate = jest.spyOn(PagoRepository.prototype, 'create');
    const commit = jest.spyOn(InventarioRepository.prototype, 'commitReservation').mockResolvedValue(true);
    const release = jest.spyOn(InventarioRepository.prototype, 'releaseReservation').mockResolvedValue(true);
    const { app } = buildApp({});

    const first = await request(app).get('/api/ordenes/5').set(authAs(1));
    expect(first.status).toBe(200);
    expect(first.body.data.estado).toBe('pendiente');
    const second = await request(app).get('/api/ordenes/5').set(authAs(1));
    expect(second.body.data.estado).toBe('pendiente');

    expect(save).not.toHaveBeenCalled();
    expect(pagoCreate).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();
  });

  it('cannot confirm through the legacy confirmar endpoint (gateway gate)', async () => {
    jest.spyOn(UsuarioRepository.prototype, 'findById')
      .mockResolvedValue({ id: 1, rol: 'comprador', plan: 'free' });
    const save = jest.spyOn(OrdenRepository.prototype, 'save');
    const pagoCreate = jest.spyOn(PagoRepository.prototype, 'create');
    const { app } = buildApp({});

    const response = await request(app).post('/api/pagos/5/confirmar').set(authAs(1)).send({});

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/gateway/i);
    expect(save).not.toHaveBeenCalled();
    expect(pagoCreate).not.toHaveBeenCalled();
  });
});

describe('TEST 3 — fake unsigned webhook is rejected', () => {
  it('returns 401 without touching the gateway or the database', async () => {
    const save = jest.spyOn(OrdenRepository.prototype, 'save');
    const pagoCreate = jest.spyOn(PagoRepository.prototype, 'create');
    const commit = jest.spyOn(InventarioRepository.prototype, 'commitReservation').mockResolvedValue(true);
    const release = jest.spyOn(InventarioRepository.prototype, 'releaseReservation').mockResolvedValue(true);
    const consultarPago = jest.fn().mockResolvedValue({ ...approvedPayment });
    const { app } = buildApp({ paymentGateway: { consultarPago, crearPreferencia: jest.fn() } });

    const response = await request(app)
      .post('/api/pagos/webhook')
      .send({ data: { id: 'pay-123' } });

    expect(response.status).toBe(401);
    expect(response.body.code).toBe('INVALID_WEBHOOK_SIGNATURE');
    expect(consultarPago).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(pagoCreate).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();
  });
});

describe('TEST 4 — invalid signature means no database changes', () => {
  it('returns 401 and writes nothing', async () => {
    jest.spyOn(OrdenRepository.prototype, 'findById')
      .mockResolvedValue({ ...baseOrden, createdAt: freshDate() });
    const save = jest.spyOn(OrdenRepository.prototype, 'save');
    const pagoCreate = jest.spyOn(PagoRepository.prototype, 'create');
    const reciboCreate = jest.spyOn(ReciboTransaccionRepository.prototype, 'create');
    const commit = jest.spyOn(InventarioRepository.prototype, 'commitReservation').mockResolvedValue(true);
    const release = jest.spyOn(InventarioRepository.prototype, 'releaseReservation').mockResolvedValue(true);
    const consultarPago = jest.fn().mockResolvedValue({ ...approvedPayment });
    const { app } = buildApp({ paymentGateway: { consultarPago, crearPreferencia: jest.fn() } });
    const headers = signedHeaders({});
    headers['x-signature'] = `${headers['x-signature']}forged`;

    const response = await request(app)
      .post('/api/pagos/webhook')
      .set(headers)
      .send({ data: { id: 'pay-123' } });

    expect(response.status).toBe(401);
    expect(response.body.code).toBe('INVALID_WEBHOOK_SIGNATURE');
    expect(consultarPago).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(pagoCreate).not.toHaveBeenCalled();
    expect(reciboCreate).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();
  });
});

describe('TEST 5 — approved verified payment finalizes exactly once', () => {
  const pendingOrden = () => ({ ...baseOrden, createdAt: freshDate() });

  function mockApprovedWorld(orden) {
    jest.spyOn(OrdenRepository.prototype, 'findById').mockResolvedValue({ ...orden });
    const save = jest.spyOn(OrdenRepository.prototype, 'save')
      .mockImplementation(async (id, data) => ({ ...orden, ...data }));
    const pagoCreate = jest.spyOn(PagoRepository.prototype, 'create')
      .mockImplementation(async (data) => ({ id: 1, ...data }));
    const reciboCreate = jest.spyOn(ReciboTransaccionRepository.prototype, 'create')
      .mockImplementation(async (data) => ({ id: 1, ...data }));
    const commit = jest.spyOn(InventarioRepository.prototype, 'commitReservation').mockResolvedValue(true);
    const release = jest.spyOn(InventarioRepository.prototype, 'releaseReservation').mockResolvedValue(true);
    return { save, pagoCreate, reciboCreate, commit, release };
  }

  it('confirms one order, one payment, one receipt and one stock commit', async () => {
    const spies = mockApprovedWorld(pendingOrden());
    const consultarPago = jest.fn().mockResolvedValue({ ...approvedPayment });
    const { app, published } = buildApp({ paymentGateway: { consultarPago, crearPreferencia: jest.fn() } });

    const response = await request(app)
      .post('/api/pagos/webhook')
      .set(signedHeaders({}))
      .send({ data: { id: 'pay-123' } });

    expect(response.status).toBe(200);
    expect(response.body.message).toMatch(/confirmado/i);
    expect(consultarPago).toHaveBeenCalledWith('pay-123');
    expect(spies.save).toHaveBeenCalledWith('5', expect.objectContaining({ estado: 'pagada' }));
    expect(spies.pagoCreate).toHaveBeenCalledTimes(1);
    expect(spies.pagoCreate).toHaveBeenCalledWith(expect.objectContaining({ ordenId: '5', monto: 50 }));
    expect(spies.reciboCreate).toHaveBeenCalledTimes(1);
    expect(spies.reciboCreate).toHaveBeenCalledWith(
      expect.objectContaining({ ordenId: '5', folio: expect.stringContaining('MPpay-123') }),
    );
    expect(spies.commit).toHaveBeenCalledTimes(1);
    expect(spies.commit).toHaveBeenCalledWith(1, 2, expect.anything());
    expect(spies.release).not.toHaveBeenCalled();
    const paid = published.filter(([name]) => name === EventBus.EVENTS.ORDER_PAID);
    expect(paid).toHaveLength(1);
    expect(paid[0][1]).toMatchObject({ stockCommitted: true });
  });

  it('confirms an order waiting in procesando (preference-then-webhook path)', async () => {
    const spies = mockApprovedWorld({ ...pendingOrden(), estado: 'procesando' });
    const consultarPago = jest.fn().mockResolvedValue({ ...approvedPayment });
    const { app } = buildApp({ paymentGateway: { consultarPago, crearPreferencia: jest.fn() } });

    const response = await request(app)
      .post('/api/pagos/webhook')
      .set(signedHeaders({}))
      .send({ data: { id: 'pay-123' } });

    expect(response.status).toBe(200);
    expect(response.body.message).toMatch(/confirmado/i);
    expect(spies.pagoCreate).toHaveBeenCalledTimes(1);
    expect(spies.commit).toHaveBeenCalledTimes(1);
  });

  it('aborts the whole purchase when stock cannot cover the order', async () => {
    const spies = mockApprovedWorld(pendingOrden());
    spies.commit.mockResolvedValue(false);
    const consultarPago = jest.fn().mockResolvedValue({ ...approvedPayment });
    const { app, published } = buildApp({ paymentGateway: { consultarPago, crearPreferencia: jest.fn() } });

    const response = await request(app)
      .post('/api/pagos/webhook')
      .set(signedHeaders({}))
      .send({ data: { id: 'pay-123' } });

    expect(response.status).toBe(422);
    expect(response.body.message).toMatch(/stock/i);
    // Production rolls the writes back in the Sequelize transaction; the
    // observable proof here is that no ORDER_PAID ever leaves the route.
    expect(published.filter(([name]) => name === EventBus.EVENTS.ORDER_PAID)).toHaveLength(0);
  });
});

describe('TEST 6/7/8 — rejected, cancelled and expired payments never confirm', () => {
  it.each(['rejected', 'cancelled', 'expired'])(
    'cancels and releases the reservation on %s (no order, no deduction)',
    async (status) => {
      const orden = { ...baseOrden, createdAt: freshDate() };
      jest.spyOn(OrdenRepository.prototype, 'findById').mockResolvedValue({ ...orden });
      const save = jest.spyOn(OrdenRepository.prototype, 'save')
        .mockImplementation(async (id, data) => ({ ...orden, ...data }));
      const pagoCreate = jest.spyOn(PagoRepository.prototype, 'create');
      const commit = jest.spyOn(InventarioRepository.prototype, 'commitReservation').mockResolvedValue(true);
      const release = jest.spyOn(InventarioRepository.prototype, 'releaseReservation').mockResolvedValue(true);
      const consultarPago = jest.fn().mockResolvedValue({ ...approvedPayment, status });
      const { app, published } = buildApp({ paymentGateway: { consultarPago, crearPreferencia: jest.fn() } });

      const response = await request(app)
        .post('/api/pagos/webhook')
        .set(signedHeaders({}))
        .send({ data: { id: 'pay-123' } });

      expect(response.status).toBe(200);
      expect(save).toHaveBeenCalledWith('5', { estado: 'cancelada' }, expect.anything());
      expect(release).toHaveBeenCalledWith(1, 2, expect.anything());
      expect(pagoCreate).not.toHaveBeenCalled();
      expect(commit).not.toHaveBeenCalled();
      expect(published).toContainEqual(
        [EventBus.EVENTS.ORDER_CANCELLED, expect.objectContaining({ stockReleased: true })],
      );
    },
  );

  it('releases instead of confirming when the reservation TTL expired (late approval)', async () => {
    const orden = { ...baseOrden, createdAt: expiredDate() };
    jest.spyOn(OrdenRepository.prototype, 'findById').mockResolvedValue({ ...orden });
    const save = jest.spyOn(OrdenRepository.prototype, 'save')
      .mockImplementation(async (id, data) => ({ ...orden, ...data }));
    const pagoCreate = jest.spyOn(PagoRepository.prototype, 'create');
    const commit = jest.spyOn(InventarioRepository.prototype, 'commitReservation').mockResolvedValue(true);
    const release = jest.spyOn(InventarioRepository.prototype, 'releaseReservation').mockResolvedValue(true);
    const consultarPago = jest.fn().mockResolvedValue({ ...approvedPayment });
    const { app, published } = buildApp({ paymentGateway: { consultarPago, crearPreferencia: jest.fn() } });

    const response = await request(app)
      .post('/api/pagos/webhook')
      .set(signedHeaders({}))
      .send({ data: { id: 'pay-123' } });

    expect(response.status).toBe(200);
    expect(response.body.message).toMatch(/expiró/);
    expect(save).toHaveBeenCalledWith('5', { estado: 'cancelada' }, expect.anything());
    expect(release).toHaveBeenCalledWith(1, 2, expect.anything());
    expect(pagoCreate).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
    expect(published.filter(([name]) => name === EventBus.EVENTS.ORDER_PAID)).toHaveLength(0);
  });
});

describe('TEST 9 — duplicate approved webhooks finalize only once', () => {
  it('treats the retry as already-processed with no second payment or deduction', async () => {
    const orden = { ...baseOrden, createdAt: freshDate() };
    let estado = 'pendiente';
    jest.spyOn(OrdenRepository.prototype, 'findById')
      .mockImplementation(async () => ({ ...orden, estado }));
    jest.spyOn(OrdenRepository.prototype, 'save')
      .mockImplementation(async (id, data) => {
        estado = data.estado || estado;
        return { ...orden, estado };
      });
    const pagoCreate = jest.spyOn(PagoRepository.prototype, 'create')
      .mockImplementation(async (data) => ({ id: 1, ...data }));
    jest.spyOn(ReciboTransaccionRepository.prototype, 'create')
      .mockImplementation(async (data) => ({ id: 1, ...data }));
    const commit = jest.spyOn(InventarioRepository.prototype, 'commitReservation').mockResolvedValue(true);
    const release = jest.spyOn(InventarioRepository.prototype, 'releaseReservation').mockResolvedValue(true);
    const consultarPago = jest.fn().mockResolvedValue({ ...approvedPayment });
    const { app } = buildApp({ paymentGateway: { consultarPago, crearPreferencia: jest.fn() } });

    const first = await request(app)
      .post('/api/pagos/webhook')
      .set(signedHeaders({}))
      .send({ data: { id: 'pay-123' } });
    expect(first.status).toBe(200);
    expect(first.body.message).toMatch(/confirmado/i);

    const second = await request(app)
      .post('/api/pagos/webhook')
      .set(signedHeaders({}))
      .send({ data: { id: 'pay-123' } });
    expect(second.status).toBe(200);
    expect(second.body.message).toMatch(/ya había sido procesado/i);

    expect(pagoCreate).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(release).not.toHaveBeenCalled();
    expect(estado).toBe('pagada');
  });

  it('ignores deliveries for already-completed orders', async () => {
    jest.spyOn(OrdenRepository.prototype, 'findById')
      .mockResolvedValue({ ...baseOrden, createdAt: freshDate(), estado: 'completada' });
    const save = jest.spyOn(OrdenRepository.prototype, 'save');
    const pagoCreate = jest.spyOn(PagoRepository.prototype, 'create');
    const consultarPago = jest.fn().mockResolvedValue({ ...approvedPayment });
    const { app } = buildApp({ paymentGateway: { consultarPago, crearPreferencia: jest.fn() } });

    const response = await request(app)
      .post('/api/pagos/webhook')
      .set(signedHeaders({}))
      .send({ data: { id: 'pay-123' } });

    expect(response.status).toBe(200);
    expect(response.body.message).toMatch(/ya había sido procesado/i);
    expect(save).not.toHaveBeenCalled();
    expect(pagoCreate).not.toHaveBeenCalled();
  });
});

describe('TEST 10 — out-of-order webhooks never revert an approval', () => {
  it('keeps the approved order after late rejected/pending deliveries', async () => {
    const orden = { ...baseOrden, createdAt: freshDate() };
    let estado = 'pendiente';
    jest.spyOn(OrdenRepository.prototype, 'findById')
      .mockImplementation(async () => ({ ...orden, estado }));
    const save = jest.spyOn(OrdenRepository.prototype, 'save')
      .mockImplementation(async (id, data) => {
        estado = data.estado || estado;
        return { ...orden, estado };
      });
    const pagoCreate = jest.spyOn(PagoRepository.prototype, 'create')
      .mockImplementation(async (data) => ({ id: 1, ...data }));
    jest.spyOn(ReciboTransaccionRepository.prototype, 'create')
      .mockImplementation(async (data) => ({ id: 1, ...data }));
    const commit = jest.spyOn(InventarioRepository.prototype, 'commitReservation').mockResolvedValue(true);
    const release = jest.spyOn(InventarioRepository.prototype, 'releaseReservation').mockResolvedValue(true);
    const consultarPago = jest.fn().mockImplementation(async (id) => {
      if (id === 'pay-111') return { ...approvedPayment, status: 'approved' };
      if (id === 'pay-222') return { ...approvedPayment, status: 'rejected' };
      return { ...approvedPayment, status: 'pending' };
    });
    const { app } = buildApp({ paymentGateway: { consultarPago, crearPreferencia: jest.fn() } });

    const first = await request(app)
      .post('/api/pagos/webhook')
      .set(signedHeaders({ dataId: 'pay-111' }))
      .send({ data: { id: 'pay-111' } });
    expect(first.body.message).toMatch(/confirmado/i);

    const lateRejected = await request(app)
      .post('/api/pagos/webhook')
      .set(signedHeaders({ dataId: 'pay-222' }))
      .send({ data: { id: 'pay-222' } });
    expect(lateRejected.status).toBe(200);
    expect(lateRejected.body.message).toMatch(/ya había sido procesado/i);

    const latePending = await request(app)
      .post('/api/pagos/webhook')
      .set(signedHeaders({ dataId: 'pay-333' }))
      .send({ data: { id: 'pay-333' } });
    expect(latePending.body.message).toMatch(/ya había sido procesado/i);

    expect(estado).toBe('pagada');
    for (const call of save.mock.calls) {
      expect(call[1].estado).not.toBe('cancelada');
    }
    expect(pagoCreate).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(release).not.toHaveBeenCalled();
  });
});

describe('TEST 11/12/13 — mismatched payments are rejected, never confirmed', () => {
  function mockMismatchWorld(payment, orden = { ...baseOrden, createdAt: freshDate() }) {
    jest.spyOn(OrdenRepository.prototype, 'findById').mockResolvedValue(orden ? { ...orden } : null);
    const save = jest.spyOn(OrdenRepository.prototype, 'save');
    const pagoCreate = jest.spyOn(PagoRepository.prototype, 'create');
    const commit = jest.spyOn(InventarioRepository.prototype, 'commitReservation').mockResolvedValue(true);
    const release = jest.spyOn(InventarioRepository.prototype, 'releaseReservation').mockResolvedValue(true);
    const consultarPago = jest.fn().mockResolvedValue({ ...payment });
    const harness = buildApp({ paymentGateway: { consultarPago, crearPreferencia: jest.fn() } });
    return { ...harness, save, pagoCreate, commit, release };
  }

  async function postWebhook(app, dataId = 'pay-123') {
    return request(app)
      .post('/api/pagos/webhook')
      .set(signedHeaders({ dataId }))
      .send({ data: { id: dataId } });
  }

  it('TEST 11: amount mismatch → 422, no confirmation, no deduction', async () => {
    const { app, save, pagoCreate, commit, release } = mockMismatchWorld({
      ...approvedPayment,
      transaction_amount: 49,
    });

    const response = await postWebhook(app);

    expect(response.status).toBe(422);
    expect(response.body.message).toMatch(/monto/i);
    expect(save).not.toHaveBeenCalled();
    expect(pagoCreate).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();
  });

  it('TEST 12a: conflicting external references → 422 before any DB work', async () => {
    const { app, runInTransaction, save, pagoCreate } = mockMismatchWorld({
      ...approvedPayment,
      external_reference: '5',
      metadata: { ordenId: '6' },
    });

    const response = await postWebhook(app);

    expect(response.status).toBe(422);
    expect(response.body.message).toMatch(/referencia/i);
    expect(runInTransaction).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(pagoCreate).not.toHaveBeenCalled();
  });

  it('TEST 12b: unknown reference → 404, nothing written', async () => {
    const { app, save, pagoCreate, commit, release } = mockMismatchWorld(
      { ...approvedPayment, external_reference: '999' },
      null,
    );

    const response = await postWebhook(app);

    expect(response.status).toBe(404);
    expect(save).not.toHaveBeenCalled();
    expect(pagoCreate).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();
  });

  it('TEST 12c: missing reference → 422, nothing written', async () => {
    const { app, runInTransaction, save, pagoCreate } = mockMismatchWorld({
      status: 'approved',
      transaction_amount: 50,
      currency_id: 'MXN',
    });

    const response = await postWebhook(app);

    expect(response.status).toBe(422);
    expect(response.body.message).toMatch(/asociada/);
    expect(runInTransaction).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(pagoCreate).not.toHaveBeenCalled();
  });

  it('TEST 13: currency mismatch → 422, no confirmation, no deduction', async () => {
    const { app, save, pagoCreate, commit, release } = mockMismatchWorld({
      ...approvedPayment,
      currency_id: 'USD',
    });

    const response = await postWebhook(app);

    expect(response.status).toBe(422);
    expect(response.body.message).toMatch(/moneda/i);
    expect(save).not.toHaveBeenCalled();
    expect(pagoCreate).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();
  });
});

describe('TEST 14 — concurrent checkouts cannot oversell', () => {
  function atomicInventoryWorld() {
    const stock = { cantidadDisponible: 1, cantidadReservada: 0 };
    const inventarioRepository = {
      // Synchronous check-and-update inside one tick mirrors the single
      // conditional UPDATE in production (InventarioRepository.tryReserve).
      tryReserve: jest.fn(async (productoId, cantidad) => {
        if (stock.cantidadDisponible < cantidad) return false;
        stock.cantidadDisponible -= cantidad;
        stock.cantidadReservada += cantidad;
        return true;
      }),
      releaseReservation: jest.fn(async (productoId, cantidad) => {
        stock.cantidadDisponible += cantidad;
        stock.cantidadReservada -= cantidad;
        return true;
      }),
    };
    return { stock, inventarioRepository };
  }

  const productOwnedBy = (vendedorId) => ({
    findById: jest.fn().mockResolvedValue({ id: 9, precio: 10, estado: 'publicado', vendedorId }),
  });

  const cartFor = (usuarioId, carritoId) => ({
    findActiveByUsuarioId: jest.fn().mockResolvedValue({
      id: carritoId, usuarioId, items: [{ productoId: 9, cantidad: 1 }], estado: 'activo',
    }),
    save: jest.fn().mockResolvedValue({}),
  });

  it('lets only one of two simultaneous buyers take the last unit', async () => {
    const { stock, inventarioRepository } = atomicInventoryWorld();
    const productoRepository = productOwnedBy(99);
    let nextOrdenId = 0;
    const ordenRepository = {
      create: jest.fn().mockImplementation(async (data) => ({ id: ++nextOrdenId, ...data })),
    };
    const eventBus = new EventBus();
    const first = new CrearOrden({
      carritoRepository: cartFor(1, 101), productoRepository, ordenRepository, eventBus, inventarioRepository,
    });
    const second = new CrearOrden({
      carritoRepository: cartFor(2, 102), productoRepository, ordenRepository, eventBus, inventarioRepository,
    });

    const results = await Promise.allSettled([
      first.execute({ usuarioId: 1 }),
      second.execute({ usuarioId: 2 }),
    ]);

    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason.message).toMatch(/stock/i);
    expect(ordenRepository.create).toHaveBeenCalledTimes(1);
    expect(stock).toEqual({ cantidadDisponible: 0, cantidadReservada: 1 });
  });

  it('rolls the atomic reservation back when order creation fails afterwards', async () => {
    const { stock, inventarioRepository } = atomicInventoryWorld();
    const failingOrdenRepository = {
      create: jest.fn().mockRejectedValue(new Error('fallo al guardar')),
    };
    const useCase = new CrearOrden({
      carritoRepository: cartFor(1, 101),
      productoRepository: productOwnedBy(99),
      ordenRepository: failingOrdenRepository,
      eventBus: new EventBus(),
      inventarioRepository,
    });

    await expect(useCase.execute({ usuarioId: 1 })).rejects.toThrow(/fallo al guardar/);
    expect(inventarioRepository.releaseReservation).toHaveBeenCalledWith(9, 1);
    expect(stock).toEqual({ cantidadDisponible: 1, cantidadReservada: 0 });
  });
});

describe('TEST 15 — seller authorization fix remains intact', () => {
  // Tripwire subset: the full matrix lives in authorization.test.js and
  // Fixes.test.js. Any regression here fails fast inside the payment suite.
  const validBody = {
    categoriaId: 2,
    nombre: 'Laptop',
    descripcion: 'Equipo de cómputo',
    precio: 15000,
    cantidadDisponible: 3,
  };

  beforeEach(() => {
    jest.spyOn(ProductoRepository.prototype, 'countByVendedor').mockResolvedValue(0);
    jest.spyOn(ProductoRepository.prototype, 'create')
      .mockImplementation(async (data) => ({ id: 5, ...data }));
    jest.spyOn(InventarioRepository.prototype, 'save').mockResolvedValue({});
  });

  it.each(['vendedor', 'dual'])('a %s can publish products', async (rol) => {
    jest.spyOn(UsuarioRepository.prototype, 'findById')
      .mockResolvedValue({ id: 1, rol, plan: 'free' });
    const { app } = buildApp({});

    const response = await request(app).post('/api/productos').set(authAs(1)).send(validBody);

    expect(response.status).toBe(201);
    expect(ProductoRepository.prototype.create).toHaveBeenCalledWith(
      expect.objectContaining({ vendedorId: 1 }),
    );
  });

  it('a buyer cannot publish products', async () => {
    jest.spyOn(UsuarioRepository.prototype, 'findById')
      .mockResolvedValue({ id: 1, rol: 'comprador', plan: 'free' });
    const { app } = buildApp({});

    const response = await request(app).post('/api/productos').set(authAs(1)).send(validBody);

    expect(response.status).toBe(403);
    expect(ProductoRepository.prototype.create).not.toHaveBeenCalled();
  });

  it('a forged vendedorId cannot impersonate another seller', async () => {
    jest.spyOn(UsuarioRepository.prototype, 'findById')
      .mockResolvedValue({ id: 1, rol: 'vendedor', plan: 'premium' });
    const { app } = buildApp({});

    const response = await request(app)
      .post('/api/productos')
      .set(authAs(1))
      .send({ ...validBody, vendedorId: 2 });

    expect(response.status).toBe(201);
    expect(ProductoRepository.prototype.create).toHaveBeenCalledWith(
      expect.objectContaining({ vendedorId: 1 }),
    );
    expect(ProductoRepository.prototype.create).not.toHaveBeenCalledWith(
      expect.objectContaining({ vendedorId: 2 }),
    );
  });
});

describe('hardening extras — discount forgery, cancel route, self-purchase', () => {
  it('silently ignores a forged descuento in POST /ordenes', async () => {
    jest.spyOn(UsuarioRepository.prototype, 'findById')
      .mockResolvedValue({ id: 1, rol: 'comprador', plan: 'free' });
    jest.spyOn(OrdenRepository.prototype, 'findExpirableCandidates').mockResolvedValue([]);
    jest.spyOn(CarritoRepository.prototype, 'findActiveByUsuarioId').mockResolvedValue({
      id: 4, usuarioId: 1, items: [{ productoId: 9, cantidad: 1 }], estado: 'activo',
    });
    jest.spyOn(ProductoRepository.prototype, 'findById').mockResolvedValue({
      id: 9, precio: '10.00', estado: 'publicado', vendedorId: 2,
    });
    jest.spyOn(InventarioRepository.prototype, 'tryReserve').mockResolvedValue(true);
    jest.spyOn(InventarioRepository.prototype, 'releaseReservation').mockResolvedValue(true);
    const create = jest.spyOn(OrdenRepository.prototype, 'create')
      .mockImplementation(async (data) => ({ id: 8, ...data }));
    jest.spyOn(CarritoRepository.prototype, 'save').mockResolvedValue({});
    const { app } = buildApp({});

    const response = await request(app)
      .post('/api/ordenes')
      .set(authAs(1))
      .send({ puntoEntrega: 'Biblioteca', descuento: 999 });

    expect(response.status).toBe(201);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ descuento: 0 }));
  });

  it('exposes POST /ordenes/:id/cancelar without any prior order (no nested registration)', async () => {
    jest.spyOn(UsuarioRepository.prototype, 'findById')
      .mockResolvedValue({ id: 1, rol: 'comprador', plan: 'free' });
    jest.spyOn(OrdenRepository.prototype, 'findById')
      .mockResolvedValue({ id: 8, compradorId: 1, estado: 'pendiente', lineas: [] });
    const cancelIfOpen = jest.spyOn(OrdenRepository.prototype, 'cancelIfOpen').mockResolvedValue(true);
    const { app, published } = buildApp({});

    const response = await request(app).post('/api/ordenes/8/cancelar').set(authAs(1));

    expect(response.status).toBe(200);
    expect(cancelIfOpen).toHaveBeenCalledWith(8);
    expect(published).toContainEqual(
      [EventBus.EVENTS.ORDER_CANCELLED, expect.objectContaining({ stockReleased: true })],
    );
  });

  it('blocks orders for the seller’s own products', async () => {
    const ordenRepository = { create: jest.fn() };
    const inventarioRepository = { tryReserve: jest.fn(), releaseReservation: jest.fn() };
    const useCase = new CrearOrden({
      carritoRepository: {
        findActiveByUsuarioId: jest.fn().mockResolvedValue({
          id: 4, usuarioId: 1, items: [{ productoId: 9, cantidad: 1 }], estado: 'activo',
        }),
        save: jest.fn(),
      },
      productoRepository: {
        findById: jest.fn().mockResolvedValue({ id: 9, precio: 10, estado: 'publicado', vendedorId: 1 }),
      },
      ordenRepository,
      eventBus: new EventBus(),
      inventarioRepository,
    });

    await expect(useCase.execute({ usuarioId: 1 })).rejects.toThrow(/propios/);
    expect(ordenRepository.create).not.toHaveBeenCalled();
    expect(inventarioRepository.tryReserve).not.toHaveBeenCalled();
  });
});

describe('EXPIRY — automatic expiration sweeper', () => {
  const expiredOrden = (id, estado = 'pendiente') => ({
    id, compradorId: 1, estado, createdAt: expiredDate(), lineas: [{ productoId: 1, cantidad: 1 }],
  });

  it('expires only open orders older than the TTL via the maintenance endpoint', async () => {
    jest.spyOn(UsuarioRepository.prototype, 'findById')
      .mockResolvedValue({ id: 1, rol: 'vendedor', plan: 'free' });
    jest.spyOn(OrdenRepository.prototype, 'findExpirableCandidates').mockResolvedValue([
      expiredOrden(7, 'pendiente'),
      expiredOrden(8, 'procesando'),
      { ...expiredOrden(9), createdAt: freshDate() },
      { ...expiredOrden(10), estado: 'pagada' },
    ]);
    const cancelIfOpen = jest.spyOn(OrdenRepository.prototype, 'cancelIfOpen').mockResolvedValue(true);
    const release = jest.spyOn(InventarioRepository.prototype, 'releaseReservation').mockResolvedValue(true);
    const { app, published } = buildApp({});

    const response = await request(app).post('/api/mantenimiento/expirar-reservas').set(authAs(1));

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ expiradas: 2, ids: [7, 8], fallos: [] });
    expect(cancelIfOpen).toHaveBeenCalledWith(7);
    expect(cancelIfOpen).toHaveBeenCalledWith(8);
    expect(cancelIfOpen).not.toHaveBeenCalledWith(9);
    expect(cancelIfOpen).not.toHaveBeenCalledWith(10);
    expect(release).toHaveBeenCalledTimes(2);
    expect(published.filter(([name]) => name === EventBus.EVENTS.ORDER_CANCELLED)).toHaveLength(2);
    for (const [, payload] of published) {
      expect(payload).toMatchObject({ stockReleased: true });
    }
  });

  it('requires authentication on the maintenance endpoint', async () => {
    const { app } = buildApp({});
    const response = await request(app).post('/api/mantenimiento/expirar-reservas');
    expect(response.status).toBe(401);
  });

  it('forbids ordinary buyers on the maintenance endpoint (seller roles only)', async () => {
    jest.spyOn(UsuarioRepository.prototype, 'findById')
      .mockResolvedValue({ id: 1, rol: 'comprador', plan: 'free' });
    const findCandidates = jest.spyOn(OrdenRepository.prototype, 'findExpirableCandidates');
    const cancelIfOpen = jest.spyOn(OrdenRepository.prototype, 'cancelIfOpen');
    const { app } = buildApp({});

    const response = await request(app).post('/api/mantenimiento/expirar-reservas').set(authAs(1));

    expect(response.status).toBe(403);
    expect(findCandidates).not.toHaveBeenCalled();
    expect(cancelIfOpen).not.toHaveBeenCalled();
  });

  it('runs a bounded piggyback sweep on every checkout', async () => {
    jest.spyOn(UsuarioRepository.prototype, 'findById')
      .mockResolvedValue({ id: 1, rol: 'comprador', plan: 'free' });
    jest.spyOn(OrdenRepository.prototype, 'findExpirableCandidates').mockResolvedValue([expiredOrden(7)]);
    const cancelIfOpen = jest.spyOn(OrdenRepository.prototype, 'cancelIfOpen').mockResolvedValue(true);
    const release = jest.spyOn(InventarioRepository.prototype, 'releaseReservation').mockResolvedValue(true);
    jest.spyOn(CarritoRepository.prototype, 'findActiveByUsuarioId').mockResolvedValue({
      id: 4, usuarioId: 1, items: [{ productoId: 9, cantidad: 1 }], estado: 'activo',
    });
    jest.spyOn(ProductoRepository.prototype, 'findById').mockResolvedValue({
      id: 9, precio: '10.00', estado: 'publicado', vendedorId: 2,
    });
    jest.spyOn(InventarioRepository.prototype, 'tryReserve').mockResolvedValue(true);
    const create = jest.spyOn(OrdenRepository.prototype, 'create')
      .mockImplementation(async (data) => ({ id: 50, ...data }));
    jest.spyOn(CarritoRepository.prototype, 'save').mockResolvedValue({});
    const { app } = buildApp({});

    const response = await request(app)
      .post('/api/ordenes')
      .set(authAs(1))
      .send({ puntoEntrega: 'Biblioteca' });

    expect(response.status).toBe(201);
    expect(cancelIfOpen).toHaveBeenCalledWith(7);
    expect(release).toHaveBeenCalledWith(1, 1);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('never lets a sweep failure break checkout', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(UsuarioRepository.prototype, 'findById')
      .mockResolvedValue({ id: 1, rol: 'comprador', plan: 'free' });
    jest.spyOn(OrdenRepository.prototype, 'findExpirableCandidates').mockRejectedValue(new Error('db down'));
    jest.spyOn(CarritoRepository.prototype, 'findActiveByUsuarioId').mockResolvedValue({
      id: 4, usuarioId: 1, items: [{ productoId: 9, cantidad: 1 }], estado: 'activo',
    });
    jest.spyOn(ProductoRepository.prototype, 'findById').mockResolvedValue({
      id: 9, precio: '10.00', estado: 'publicado', vendedorId: 2,
    });
    jest.spyOn(InventarioRepository.prototype, 'tryReserve').mockResolvedValue(true);
    jest.spyOn(InventarioRepository.prototype, 'releaseReservation').mockResolvedValue(true);
    const create = jest.spyOn(OrdenRepository.prototype, 'create')
      .mockImplementation(async (data) => ({ id: 50, ...data }));
    jest.spyOn(CarritoRepository.prototype, 'save').mockResolvedValue({});
    const { app } = buildApp({});

    const response = await request(app)
      .post('/api/ordenes')
      .set(authAs(1))
      .send({ puntoEntrega: 'Biblioteca' });

    expect(response.status).toBe(201);
    expect(create).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalled();
  });

  it('reports per-order failures without aborting the batch', async () => {
    const NOW = Date.now();
    const old = new Date(NOW - 31 * 60 * 1000).toISOString();
    const ordenRepository = {
      findExpirableCandidates: jest.fn().mockResolvedValue([
        { id: 7, estado: 'pendiente', createdAt: old, lineas: [{ productoId: 1, cantidad: 1 }] },
        { id: 8, estado: 'pendiente', createdAt: old, lineas: [{ productoId: 2, cantidad: 1 }] },
      ]),
      cancelIfOpen: jest.fn().mockResolvedValue(true),
    };
    const inventarioRepository = {
      releaseReservation: jest.fn().mockImplementation(async (productoId) => {
        if (productoId === 2) throw new Error('boom');
        return true;
      }),
    };
    const eventBus = new EventBus();
    const publish = jest.spyOn(eventBus, 'publish');

    const result = await new ExpirarReservasVencidas({
      ordenRepository, inventarioRepository, eventBus, ttlMs: 30 * 60 * 1000, now: () => NOW,
    }).execute();

    expect(result.expiradas).toBe(1);
    expect(result.ids).toEqual([7]);
    expect(result.fallos).toHaveLength(1);
    expect(result.fallos[0]).toMatchObject({ ordenId: 8 });
    expect(publish).toHaveBeenCalledTimes(1);
  });
});

describe('EXPIRY — concurrent expiry attempts release only once', () => {
  it('two simultaneous sweeps claim once and release once', async () => {
    const NOW = Date.now();
    const old = new Date(NOW - 31 * 60 * 1000).toISOString();
    const orden = { id: 7, estado: 'pendiente', createdAt: old, lineas: [{ productoId: 1, cantidad: 2 }] };
    let claimed = false;
    const ordenRepository = {
      findExpirableCandidates: jest.fn().mockResolvedValue([{ ...orden }]),
      cancelIfOpen: jest.fn().mockImplementation(async () => {
        if (claimed) return false;
        claimed = true;
        return true;
      }),
    };
    const inventarioRepository = { releaseReservation: jest.fn().mockResolvedValue(true) };
    const sweep = () => new ExpirarReservasVencidas({
      ordenRepository, inventarioRepository, eventBus: new EventBus(),
      ttlMs: 30 * 60 * 1000, now: () => NOW,
    }).execute();

    const [first, second] = await Promise.all([sweep(), sweep()]);

    expect(first.expiradas + second.expiradas).toBe(1);
    expect(inventarioRepository.releaseReservation).toHaveBeenCalledTimes(1);
    expect(inventarioRepository.releaseReservation).toHaveBeenCalledWith(1, 2);
  });
});

describe('RACE — cancellation racing with approval', () => {
  it('cancel wins: a late webhook approval lands already-processed', async () => {
    const orden = { ...baseOrden, createdAt: freshDate() };
    let estado = 'pendiente';
    jest.spyOn(UsuarioRepository.prototype, 'findById')
      .mockResolvedValue({ id: 1, rol: 'comprador', plan: 'free' });
    jest.spyOn(OrdenRepository.prototype, 'findById')
      .mockImplementation(async () => ({ ...orden, estado }));
    jest.spyOn(OrdenRepository.prototype, 'cancelIfOpen')
      .mockImplementation(async () => {
        if (estado !== 'pendiente' && estado !== 'procesando') return false;
        estado = 'cancelada';
        return true;
      });
    jest.spyOn(OrdenRepository.prototype, 'save')
      .mockImplementation(async (id, data) => {
        estado = data.estado || estado;
        return { ...orden, estado };
      });
    const pagoCreate = jest.spyOn(PagoRepository.prototype, 'create')
      .mockImplementation(async (data) => ({ id: 1, ...data }));
    jest.spyOn(ReciboTransaccionRepository.prototype, 'create')
      .mockImplementation(async (data) => ({ id: 1, ...data }));
    const commit = jest.spyOn(InventarioRepository.prototype, 'commitReservation').mockResolvedValue(true);
    jest.spyOn(InventarioRepository.prototype, 'releaseReservation').mockResolvedValue(true);
    const consultarPago = jest.fn().mockResolvedValue({ ...approvedPayment });
    const { app } = buildApp({ paymentGateway: { consultarPago, crearPreferencia: jest.fn() } });

    const cancelled = await request(app).post('/api/ordenes/5/cancelar').set(authAs(1));
    expect(cancelled.status).toBe(200);
    expect(estado).toBe('cancelada');

    const late = await request(app)
      .post('/api/pagos/webhook')
      .set(signedHeaders({}))
      .send({ data: { id: 'pay-123' } });
    expect(late.status).toBe(200);
    expect(late.body.message).toMatch(/ya había sido procesado/i);
    expect(pagoCreate).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
    expect(estado).toBe('cancelada');
  });

  it('approval wins: a late cancel loses the claim with 409 and touches no stock', async () => {
    jest.spyOn(UsuarioRepository.prototype, 'findById')
      .mockResolvedValue({ id: 1, rol: 'comprador', plan: 'free' });
    jest.spyOn(OrdenRepository.prototype, 'findById')
      .mockResolvedValue({ ...baseOrden, createdAt: freshDate() });
    const cancelIfOpen = jest.spyOn(OrdenRepository.prototype, 'cancelIfOpen').mockResolvedValue(false);
    const release = jest.spyOn(InventarioRepository.prototype, 'releaseReservation').mockResolvedValue(true);
    const { app, published } = buildApp({});

    const response = await request(app).post('/api/ordenes/5/cancelar').set(authAs(1));

    expect(response.status).toBe(409);
    expect(response.body.message).toMatch(/procesada/);
    expect(cancelIfOpen).toHaveBeenCalledWith(5);
    expect(release).not.toHaveBeenCalled();
    expect(published.filter(([name]) => name === EventBus.EVENTS.ORDER_CANCELLED)).toHaveLength(0);
  });

  it('duplicate cancels are harmless: the retry gets 409 with a single release', async () => {
    jest.spyOn(UsuarioRepository.prototype, 'findById')
      .mockResolvedValue({ id: 1, rol: 'comprador', plan: 'free' });
    jest.spyOn(OrdenRepository.prototype, 'findById')
      .mockResolvedValue({ ...baseOrden, createdAt: freshDate() });
    let calls = 0;
    jest.spyOn(OrdenRepository.prototype, 'cancelIfOpen').mockImplementation(async () => {
      calls += 1;
      return calls === 1;
    });
    const release = jest.spyOn(InventarioRepository.prototype, 'releaseReservation').mockResolvedValue(true);
    const { app } = buildApp({});

    const first = await request(app).post('/api/ordenes/5/cancelar').set(authAs(1));
    const second = await request(app).post('/api/ordenes/5/cancelar').set(authAs(1));

    expect(first.status).toBe(200);
    expect(second.status).toBe(409);
    expect(release).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledWith(1, 2);
  });
});

describe('EVENTS — publication failure cannot strand stock', () => {
  it('user cancel releases before publishing (publish throws, stock still freed)', async () => {
    jest.spyOn(UsuarioRepository.prototype, 'findById')
      .mockResolvedValue({ id: 1, rol: 'comprador', plan: 'free' });
    jest.spyOn(OrdenRepository.prototype, 'findById')
      .mockResolvedValue({ ...baseOrden, createdAt: freshDate() });
    const cancelIfOpen = jest.spyOn(OrdenRepository.prototype, 'cancelIfOpen').mockResolvedValue(true);
    const release = jest.spyOn(InventarioRepository.prototype, 'releaseReservation').mockResolvedValue(true);
    const { app, eventBus } = buildApp({});
    eventBus.publish.mockImplementation(() => {
      throw new Error('bus down');
    });

    const response = await request(app).post('/api/ordenes/5/cancelar').set(authAs(1));

    expect(cancelIfOpen).toHaveBeenCalledWith(5);
    expect(release).toHaveBeenCalledWith(1, 2);
    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/bus down/);
  });
});

describe('GUARD — approved payments resist late cancellation', () => {
  it('rejects cancel for pagada without touching the claim or stock', async () => {
    jest.spyOn(UsuarioRepository.prototype, 'findById')
      .mockResolvedValue({ id: 1, rol: 'comprador', plan: 'free' });
    jest.spyOn(OrdenRepository.prototype, 'findById')
      .mockResolvedValue({ ...baseOrden, createdAt: freshDate(), estado: 'pagada' });
    const cancelIfOpen = jest.spyOn(OrdenRepository.prototype, 'cancelIfOpen').mockResolvedValue(true);
    const release = jest.spyOn(InventarioRepository.prototype, 'releaseReservation').mockResolvedValue(true);
    const { app, published } = buildApp({});

    const response = await request(app).post('/api/ordenes/5/cancelar').set(authAs(1));

    expect(response.status).toBe(422);
    expect(cancelIfOpen).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();
    expect(published).toHaveLength(0);
  });
});

describe('FOLIO — receipt folio compatibility', () => {
  function pagoWorld() {
    return {
      eventBus: new EventBus(),
      ordenRepository: {
        findById: jest.fn().mockResolvedValue({
          id: 8, compradorId: 1, descuento: 0,
          lineas: [{ productoId: 9, cantidad: 1, precioUnitario: 10 }],
        }),
        save: jest.fn().mockImplementation(async (id, data) => ({ id: 8, ...data })),
      },
      pagoRepository: { create: jest.fn().mockImplementation(async (data) => ({ id: 2, ...data })) },
      reciboRepository: { create: jest.fn().mockImplementation(async (data) => ({ id: 3, ...data })) },
    };
  }

  it('keeps the legacy RT-<ordenId>-<ts> format without a gateway id', async () => {
    const { eventBus, ...repos } = pagoWorld();
    await new ConfirmarPago({ ...repos, eventBus })
      .execute({ ordenId: 8, metodo: 'mercado_pago', gatewayConfirmed: true });

    expect(repos.reciboRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ ordenId: 8, folio: expect.stringMatching(/^RT-8-\d+$/) }),
    );
  });

  it('embeds the gateway id keeping the RT-<ordenId>- prefix', async () => {
    const { eventBus, ...repos } = pagoWorld();
    await new ConfirmarPago({ ...repos, eventBus })
      .execute({ ordenId: 8, metodo: 'mercado_pago', gatewayConfirmed: true, gatewayPaymentId: 'pay-123' });

    expect(repos.reciboRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ ordenId: 8, folio: expect.stringMatching(/^RT-8-MPpay-123-\d+$/) }),
    );
  });

  it('produces unique folios across payments', async () => {
    const first = pagoWorld();
    await new ConfirmarPago({ ...first, eventBus: first.eventBus })
      .execute({ ordenId: 8, metodo: 'mercado_pago', gatewayConfirmed: true, gatewayPaymentId: 'pay-111' });
    const second = pagoWorld();
    await new ConfirmarPago({ ...second, eventBus: second.eventBus })
      .execute({ ordenId: 8, metodo: 'mercado_pago', gatewayConfirmed: true, gatewayPaymentId: 'pay-222' });

    const folioA = first.reciboRepository.create.mock.calls[0][0].folio;
    const folioB = second.reciboRepository.create.mock.calls[0][0].folio;
    expect(folioA).not.toBe(folioB);
  });

  it('preserves MP-format folios on existing receipts (passthrough)', () => {
    expect(new ReciboTransaccion({ ordenId: 1, folio: 'RT-1-MP555-1700000000000' }).folio)
      .toBe('RT-1-MP555-1700000000000');
  });
});

describe('ROLLBACK — stock release failure during cancel', () => {
  it('cancels the order and delegates release to the listener via unflagged event', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(UsuarioRepository.prototype, 'findById')
      .mockResolvedValue({ id: 1, rol: 'comprador', plan: 'free' });
    jest.spyOn(OrdenRepository.prototype, 'findById')
      .mockResolvedValue({ ...baseOrden, createdAt: freshDate() });
    const cancelIfOpen = jest.spyOn(OrdenRepository.prototype, 'cancelIfOpen').mockResolvedValue(true);
    jest.spyOn(InventarioRepository.prototype, 'releaseReservation')
      .mockRejectedValue(new Error('db down'));
    const { app, published } = buildApp({});

    const response = await request(app).post('/api/ordenes/5/cancelar').set(authAs(1));

    expect(response.status).toBe(200);
    expect(response.body.message).toMatch(/en curso/);
    expect(cancelIfOpen).toHaveBeenCalledWith(5);
    expect(published).toHaveLength(1);
    expect(published[0][0]).toBe(EventBus.EVENTS.ORDER_CANCELLED);
    expect(published[0][1]).not.toHaveProperty('stockReleased');
    expect(console.error).toHaveBeenCalled();
  });
});
