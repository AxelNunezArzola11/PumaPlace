/**
 * Webhook delivery pre-flight tests: signature gate, API re-query,
 * idempotent double delivery and the UNIQUE-race backstop.
 * No database: repositories are spied and the transaction runner is stubbed.
 */
const express = require('express');
const request = require('supertest');
const { UniqueConstraintError } = require('sequelize');
const createApiRoutes = require('../api');
const EventBus = require('../../domain/events/EventBus');
const OrdenRepository = require('../../infrastructure/repositories/OrdenRepository');
const PagoRepository = require('../../infrastructure/repositories/PagoRepository');
const ReciboTransaccionRepository = require('../../infrastructure/repositories/ReciboTransaccionRepository');
const {
  buildManifest,
  signManifest,
} = require('../../middlewares/verifyMercadoPagoSignature');

const SECRET = 'test-webhook-secret-value';

const orden = {
  id: 5,
  compradorId: 9,
  puntoEntrega: 'Biblioteca Central',
  descuento: 0,
  estado: 'pendiente',
  lineas: [{ productoId: 1, cantidad: 2, precioUnitario: 25 }],
};

const approvedPayment = {
  status: 'approved',
  transaction_amount: 50,
  external_reference: '5',
};

function signedHeaders({ dataId = 'pay-123', requestId = 'req-abc' } = {}) {
  const ts = String(Math.floor(Date.now() / 1000));
  return {
    'x-request-id': requestId,
    'x-signature': `ts=${ts},v1=${signManifest(buildManifest({ dataId, requestId, ts }), SECRET)}`,
  };
}

function buildApp(payment) {
  const eventBus = new EventBus();
  const paymentGateway = { consultarPago: jest.fn().mockResolvedValue(payment) };
  const runInTransaction = jest.fn((work) => work({}));
  const app = express();
  app.use(express.json());
  app.use('/api', createApiRoutes({ eventBus, paymentGateway, runInTransaction }));
  // Minimal error mapper mirroring src/index.js semantics for these paths.
  // eslint-disable-next-line no-unused-vars
  app.use((error, req, res, next) => {
    const status = error.status || 400;
    res.status(status).json({ success: false, message: error.message });
  });
  return { app, eventBus, paymentGateway, runInTransaction };
}

describe('POST /api/pagos/webhook', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    process.env = {
      ...OLD_ENV,
      NODE_ENV: 'test',
      MP_WEBHOOK_SECRET: SECRET,
      // createApiRoutes builds the auth middleware eagerly.
      JWT_SECRET: OLD_ENV.JWT_SECRET || 'test-only-jwt-secret',
    };
    jest.spyOn(OrdenRepository.prototype, 'findById').mockResolvedValue({ ...orden });
    jest.spyOn(OrdenRepository.prototype, 'save').mockImplementation(async (id, data) => ({
      ...orden,
      ...data,
    }));
    jest.spyOn(PagoRepository.prototype, 'create').mockResolvedValue({ id: 1, ordenId: 5 });
    jest.spyOn(ReciboTransaccionRepository.prototype, 'create').mockResolvedValue({ id: 1, ordenId: 5 });
  });

  afterEach(() => {
    process.env = OLD_ENV;
    jest.restoreAllMocks();
  });

  it('rejects unsigned deliveries with 401 and never touches the gateway', async () => {
    const { app, paymentGateway } = buildApp(approvedPayment);
    const response = await request(app)
      .post('/api/pagos/webhook')
      .send({ data: { id: 'pay-123' } });

    expect(response.status).toBe(401);
    expect(response.body.code).toBe('INVALID_WEBHOOK_SIGNATURE');
    expect(paymentGateway.consultarPago).not.toHaveBeenCalled();
  });

  it('re-queries the Mercado Pago API instead of trusting the payload', async () => {
    const { app, paymentGateway } = buildApp(approvedPayment);
    const headers = signedHeaders({});
    const response = await request(app)
      .post('/api/pagos/webhook')
      .set(headers)
      .send({ data: { id: 'pay-123' }, fake_status: 'approved', fake_amount: 1 });

    expect(response.status).toBe(200);
    expect(paymentGateway.consultarPago).toHaveBeenCalledWith('pay-123');
  });

  it('confirms an approved payment with the exact amount inside a transaction', async () => {
    const { app, runInTransaction } = buildApp(approvedPayment);
    const response = await request(app)
      .post('/api/pagos/webhook')
      .set(signedHeaders({}))
      .send({ data: { id: 'pay-123' } });

    expect(response.status).toBe(200);
    expect(response.body.message).toMatch(/confirmado/i);
    expect(runInTransaction).toHaveBeenCalledTimes(1);
    expect(PagoRepository.prototype.create).toHaveBeenCalledTimes(1);
    // The stub runner provides no transaction, so ConfirmarPago keeps the
    // two-argument call signature; production passes { transaction }.
    expect(OrdenRepository.prototype.save).toHaveBeenCalledWith(
      '5',
      expect.objectContaining({ estado: 'pagada' }),
    );
  });

  it('treats a retried delivery of an already-paid order as success without a second payment', async () => {
    OrdenRepository.prototype.findById.mockResolvedValue({ ...orden, estado: 'pagada' });
    const { app } = buildApp(approvedPayment);
    const response = await request(app)
      .post('/api/pagos/webhook')
      .set(signedHeaders({}))
      .send({ data: { id: 'pay-123' } });

    expect(response.status).toBe(200);
    expect(response.body.message).toMatch(/ya había sido procesado/i);
    expect(PagoRepository.prototype.create).not.toHaveBeenCalled();
  });

  it('maps a UNIQUE race on pagos.ordenId to "already processed" (200, not 500)', async () => {
    PagoRepository.prototype.create.mockRejectedValue(
      new UniqueConstraintError({ fields: { ordenId: '5' } }),
    );
    const { app } = buildApp(approvedPayment);
    const response = await request(app)
      .post('/api/pagos/webhook')
      .set(signedHeaders({}))
      .send({ data: { id: 'pay-123' } });

    expect(response.status).toBe(200);
    expect(response.body.message).toMatch(/ya había sido procesado/i);
  });

  it('cancels and releases the reservation on rejected payments', async () => {
    const { app } = buildApp({ ...approvedPayment, status: 'rejected' });
    const response = await request(app)
      .post('/api/pagos/webhook')
      .set(signedHeaders({}))
      .send({ data: { id: 'pay-123' } });

    expect(response.status).toBe(200);
    expect(OrdenRepository.prototype.save).toHaveBeenCalledWith(
      '5',
      { estado: 'cancelada' },
      expect.anything(),
    );
    expect(PagoRepository.prototype.create).not.toHaveBeenCalled();
  });

  it('forwards the transaction to every write when the runner provides one', async () => {
    const eventBus = new EventBus();
    const paymentGateway = {
      consultarPago: jest.fn().mockResolvedValue({ ...approvedPayment, status: 'rejected' }),
    };
    const app = express();
    app.use(express.json());
    app.use('/api', createApiRoutes({
      eventBus,
      paymentGateway,
      runInTransaction: (work) => work({ transaction: 'tx-fake' }),
    }));
    // eslint-disable-next-line no-unused-vars
    app.use((error, req, res, next) => {
      res.status(error.status || 400).json({ success: false, message: error.message });
    });
    const response = await request(app)
      .post('/api/pagos/webhook')
      .set(signedHeaders({}))
      .send({ data: { id: 'pay-123' } });

    expect(response.status).toBe(200);
    expect(OrdenRepository.prototype.findById).toHaveBeenCalledWith(
      '5',
      { transaction: 'tx-fake' },
    );
    expect(OrdenRepository.prototype.save).toHaveBeenCalledWith(
      '5',
      { estado: 'cancelada' },
      { transaction: 'tx-fake' },
    );
  });

  it('rejects approved payments whose amount differs from the order total', async () => {
    const { app } = buildApp({ ...approvedPayment, transaction_amount: 49 });
    const response = await request(app)
      .post('/api/pagos/webhook')
      .set(signedHeaders({}))
      .send({ data: { id: 'pay-123' } });

    expect(response.status).toBe(422);
    expect(response.body.message).toMatch(/monto/i);
    expect(PagoRepository.prototype.create).not.toHaveBeenCalled();
  });
});
