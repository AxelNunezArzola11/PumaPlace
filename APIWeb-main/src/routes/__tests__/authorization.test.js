/**
 * Authorization regression tests (HIGH-1 / HIGH-2 / MEDIUM-2).
 * Proves, without a database, that role escalation is impossible, that every
 * generic DELETE except owner-scoped product deletion is gone, and that the
 * order-cancellation workflow (not deletion) releases reservations.
 */
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const createApiRoutes = require('../api');
const EventBus = require('../../domain/events/EventBus');
const UsuarioRepository = require('../../infrastructure/repositories/UsuarioRepository');
const CrudRepository = require('../../infrastructure/repositories/CrudRepository');
const OrdenRepository = require('../../infrastructure/repositories/OrdenRepository');
const CarritoRepository = require('../../infrastructure/repositories/CarritoRepository');
const ProductoRepository = require('../../infrastructure/repositories/ProductoRepository');
const InventarioRepository = require('../../infrastructure/repositories/InventarioRepository');
const PagoRepository = require('../../infrastructure/repositories/PagoRepository');
const ReciboTransaccionRepository = require('../../infrastructure/repositories/ReciboTransaccionRepository');

const JWT_SECRET = 'test-only-jwt-secret';
const tokenFor = (sub) => jwt.sign({ sub }, JWT_SECRET);
const authAs = (sub) => ({ Authorization: `Bearer ${tokenFor(sub)}` });

function buildApp() {
  const eventBus = new EventBus();
  const published = [];
  jest.spyOn(eventBus, 'publish').mockImplementation((name, payload) => {
    published.push([name, payload]);
  });
  const app = express();
  app.use(express.json());
  app.use('/api', createApiRoutes({ eventBus }));
  // eslint-disable-next-line no-unused-vars
  app.use((error, req, res, next) => {
    res.status(error.status || 400).json({ success: false, message: error.message });
  });
  return { app, published };
}

describe('user update permissions (HIGH-1)', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    process.env = { ...OLD_ENV, NODE_ENV: 'test', JWT_SECRET };
    jest.spyOn(UsuarioRepository.prototype, 'findById')
      .mockResolvedValue({ id: 1, rol: 'comprador', plan: 'free' });
  });

  afterEach(() => {
    process.env = OLD_ENV;
    jest.restoreAllMocks();
  });

  it('a user cannot change their OWN role', async () => {
    jest.spyOn(CrudRepository.prototype, 'updateById')
      .mockResolvedValue({ id: 1, rol: 'comprador', plan: 'free', edad: 20 });
    const { app } = buildApp();
    const response = await request(app)
      .patch('/api/usuarios/1')
      .set(authAs(1))
      .send({ rol: 'vendedor' });

    expect(response.status).toBe(200);
    // `rol` is stripped before persistence: only whitelisted fields pass.
    expect(CrudRepository.prototype.updateById).toHaveBeenCalledWith('1', {});
    expect(response.body.data.rol).toBe('comprador');
  });

  it('a user cannot change ANOTHER user’s role', async () => {
    const updateById = jest.spyOn(CrudRepository.prototype, 'updateById');
    const { app } = buildApp();
    const response = await request(app)
      .patch('/api/usuarios/2')
      .set(authAs(1))
      .send({ rol: 'vendedor' });

    expect(response.status).toBe(403);
    expect(updateById).not.toHaveBeenCalled();
  });

  it('a user cannot change their OWN plan', async () => {
    jest.spyOn(CrudRepository.prototype, 'updateById')
      .mockResolvedValue({ id: 1, rol: 'comprador', plan: 'free', edad: 20 });
    const { app } = buildApp();
    const response = await request(app)
      .patch('/api/usuarios/1')
      .set(authAs(1))
      .send({ plan: 'premium' });

    expect(response.status).toBe(200);
    expect(CrudRepository.prototype.updateById).toHaveBeenCalledWith('1', {});
    expect(response.body.data.plan).toBe('free');
  });

  it('a user cannot change ANOTHER user’s plan', async () => {
    const updateById = jest.spyOn(CrudRepository.prototype, 'updateById');
    const { app } = buildApp();
    const response = await request(app)
      .patch('/api/usuarios/2')
      .set(authAs(1))
      .send({ plan: 'premium' });

    expect(response.status).toBe(403);
    expect(updateById).not.toHaveBeenCalled();
  });

  it('ignores rol/plan smuggled alongside a legitimate field', async () => {
    jest.spyOn(CrudRepository.prototype, 'updateById')
      .mockResolvedValue({ id: 1, rol: 'comprador', plan: 'free', edad: 31 });
    const { app } = buildApp();
    const response = await request(app)
      .patch('/api/usuarios/1')
      .set(authAs(1))
      .send({ edad: 31, rol: 'vendedor', plan: 'premium' });

    expect(response.status).toBe(200);
    expect(CrudRepository.prototype.updateById).toHaveBeenCalledWith('1', { edad: 31 });
  });

  it('legitimate profile updates (edad) still work', async () => {
    jest.spyOn(CrudRepository.prototype, 'updateById')
      .mockResolvedValue({ id: 1, rol: 'comprador', plan: 'free', edad: 30 });
    const { app } = buildApp();
    const response = await request(app)
      .patch('/api/usuarios/1')
      .set(authAs(1))
      .send({ edad: 30 });

    expect(response.status).toBe(200);
    expect(CrudRepository.prototype.updateById).toHaveBeenCalledWith('1', { edad: 30 });
    expect(response.body.data.edad).toBe(30);
  });

  it('scopes the user directory to the caller (MEDIUM-2)', async () => {
    const findAll = jest.spyOn(CrudRepository.prototype, 'findAll')
      .mockResolvedValue([{ id: 1, rol: 'comprador' }]);
    const { app } = buildApp();
    await request(app).get('/api/usuarios').set(authAs(1));

    expect(findAll).toHaveBeenCalledWith({ where: { id: 1 } });
  });

  it('denies reading another user’s profile', async () => {
    const findById = jest.spyOn(CrudRepository.prototype, 'findById');
    const { app } = buildApp();
    const response = await request(app).get('/api/usuarios/2').set(authAs(1));

    expect(response.status).toBe(403);
    expect(findById).not.toHaveBeenCalled();
  });
});

describe('deletion permissions (HIGH-2)', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    process.env = { ...OLD_ENV, NODE_ENV: 'test', JWT_SECRET };
    jest.spyOn(UsuarioRepository.prototype, 'findById')
      .mockResolvedValue({ id: 1, rol: 'comprador', plan: 'free' });
  });

  afterEach(() => {
    process.env = OLD_ENV;
    jest.restoreAllMocks();
  });

  it.each([
    ['/api/ordenes/5'],
    ['/api/carrito/3'],
    ['/api/usuarios/1'],
    ['/api/categorias/1'],
    ['/api/pagos/1'],
    ['/api/inventario/1'],
    ['/api/cupones/1'],
    ['/api/notificaciones/1'],
    ['/api/seguimiento-stock/1'],
    ['/api/suscripciones/1'],
  ])('has no DELETE route at %s (deny by default)', async (url) => {
    const { app } = buildApp();
    const response = await request(app).delete(url).set(authAs(1));
    expect(response.status).toBe(404);
  });

  it('never invokes order deletion: owner or stranger', async () => {
    const deleteById = jest.spyOn(OrdenRepository.prototype, 'deleteById');
    const { app } = buildApp();
    await request(app).delete('/api/ordenes/5').set(authAs(1));
    await request(app).delete('/api/ordenes/5').set(authAs(2));
    expect(deleteById).not.toHaveBeenCalled();
  });

  it('forbids abandoning another user’s cart', async () => {
    jest.spyOn(CarritoRepository.prototype, 'findById')
      .mockResolvedValue({ id: 9, usuarioId: 2, items: [], estado: 'activo' });
    const save = jest.spyOn(CarritoRepository.prototype, 'save');
    const { app } = buildApp();
    const response = await request(app).post('/api/carrito/9/abandonar').set(authAs(1));

    expect(response.status).toBe(403);
    expect(save).not.toHaveBeenCalled();
  });

  it('cancels through the existing workflow and releases the reservation', async () => {
    jest.spyOn(CarritoRepository.prototype, 'findActiveByUsuarioId')
      .mockResolvedValue({ id: 4, usuarioId: 1, items: [{ productoId: 9, cantidad: 1 }], estado: 'activo' });
    jest.spyOn(ProductoRepository.prototype, 'findById')
      .mockResolvedValue({
        id: 9, precio: '10.00', estado: 'publicado',
        inventario: { productoId: 9, cantidadDisponible: 5, cantidadReservada: 0 },
      });
    jest.spyOn(InventarioRepository.prototype, 'save').mockResolvedValue({});
    // Order creation reserves atomically when the repository supports it.
    jest.spyOn(InventarioRepository.prototype, 'tryReserve').mockResolvedValue(true);
    jest.spyOn(InventarioRepository.prototype, 'releaseReservation').mockResolvedValue(true);
    // Checkout piggyback finds no expired reservations in this scenario.
    jest.spyOn(OrdenRepository.prototype, 'findExpirableCandidates').mockResolvedValue([]);
    jest.spyOn(OrdenRepository.prototype, 'create')
      .mockImplementation(async (data) => ({ id: 8, ...data }));
    jest.spyOn(CarritoRepository.prototype, 'save').mockResolvedValue({});
    const { app, published } = buildApp();

    const created = await request(app)
      .post('/api/ordenes')
      .set(authAs(1))
      .send({ puntoEntrega: 'Biblioteca' });
    expect(created.status).toBe(201);

    jest.spyOn(OrdenRepository.prototype, 'findById')
      .mockResolvedValue({ id: 8, compradorId: 1, estado: 'pendiente', lineas: [] });
    // Cancel claims the open order atomically (conditional UPDATE) so a
    // concurrent approval can never be overwritten; intent unchanged.
    const cancelIfOpen = jest.spyOn(OrdenRepository.prototype, 'cancelIfOpen').mockResolvedValue(true);
    const cancelled = await request(app).post('/api/ordenes/8/cancelar').set(authAs(1));

    expect(cancelled.status).toBe(200);
    expect(cancelIfOpen).toHaveBeenCalledWith(8);
    expect(published).toContainEqual(
      [EventBus.EVENTS.ORDER_CANCELLED, expect.objectContaining({ orden: expect.anything() })],
    );
  });

  it('exposes no repository method that could erase payment audit history', () => {
    expect(PagoRepository.prototype.deleteById).toBeUndefined();
    expect(ReciboTransaccionRepository.prototype.deleteById).toBeUndefined();
  });

  it('denies category and cart mutations left without a policy', async () => {
    const { app } = buildApp();
    for (const [method, url, body] of [
      ['patch', '/api/categorias/1', { nombre: 'Hack' }],
      ['post', '/api/categorias', { nombre: 'Hack' }],
      ['patch', '/api/carrito/3', { estado: 'abandonado' }],
      ['post', '/api/inventario', { productoId: 9, cantidadDisponible: 999 }],
    ]) {
      const response = await request(app)[method](url).set(authAs(1)).send(body);
      expect(response.status).toBe(404);
    }
  });

  it('keeps legitimate product deletion: owner 204, stranger 403', async () => {
    const deleteById = jest.spyOn(ProductoRepository.prototype, 'deleteById')
      .mockResolvedValue(true);
    const findById = jest.spyOn(ProductoRepository.prototype, 'findById');
    const { app } = buildApp();

    findById.mockResolvedValue({ id: 9, vendedorId: 1 });
    const own = await request(app).delete('/api/productos/9').set(authAs(1));
    expect(own.status).toBe(204);

    findById.mockResolvedValue({ id: 9, vendedorId: 2 });
    const foreign = await request(app).delete('/api/productos/9').set(authAs(1));
    expect(foreign.status).toBe(403);
    expect(deleteById).toHaveBeenCalledTimes(1);
  });
});

describe('update ownership (PATCH sweep)', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    process.env = { ...OLD_ENV, NODE_ENV: 'test', JWT_SECRET };
    jest.spyOn(UsuarioRepository.prototype, 'findById')
      .mockResolvedValue({ id: 1, rol: 'vendedor', plan: 'free' });
  });

  afterEach(() => {
    process.env = OLD_ENV;
    jest.restoreAllMocks();
  });

  it('lets a vendor restock their OWN product inventory', async () => {
    jest.spyOn(CrudRepository.prototype, 'findById')
      .mockResolvedValue({ id: 7, productoId: 9, cantidadDisponible: 5, cantidadReservada: 0 });
    jest.spyOn(ProductoRepository.prototype, 'findById')
      .mockResolvedValue({ id: 9, vendedorId: 1 });
    const updateById = jest.spyOn(CrudRepository.prototype, 'updateById')
      .mockResolvedValue({ id: 7, cantidadDisponible: 50 });
    const { app } = buildApp();
    const response = await request(app)
      .patch('/api/inventario/7')
      .set(authAs(1))
      .send({ cantidadDisponible: 50 });

    expect(response.status).toBe(200);
    expect(updateById).toHaveBeenCalledWith('7', { cantidadDisponible: 50 });
  });

  it('forbids touching another vendor’s inventory', async () => {
    jest.spyOn(CrudRepository.prototype, 'findById')
      .mockResolvedValue({ id: 7, productoId: 9, cantidadDisponible: 5, cantidadReservada: 0 });
    jest.spyOn(ProductoRepository.prototype, 'findById')
      .mockResolvedValue({ id: 9, vendedorId: 2 });
    const updateById = jest.spyOn(CrudRepository.prototype, 'updateById');
    const { app } = buildApp();
    const response = await request(app)
      .patch('/api/inventario/7')
      .set(authAs(1))
      .send({ cantidadDisponible: 50 });

    expect(response.status).toBe(403);
    expect(updateById).not.toHaveBeenCalled();
  });

  it('strips reservation state and ownership fields from inventory writes', async () => {
    jest.spyOn(CrudRepository.prototype, 'findById')
      .mockResolvedValue({ id: 7, productoId: 9, cantidadDisponible: 5, cantidadReservada: 0 });
    jest.spyOn(ProductoRepository.prototype, 'findById')
      .mockResolvedValue({ id: 9, vendedorId: 1 });
    const updateById = jest.spyOn(CrudRepository.prototype, 'updateById')
      .mockResolvedValue({ id: 7, cantidadDisponible: 50 });
    const { app } = buildApp();
    const response = await request(app)
      .patch('/api/inventario/7')
      .set(authAs(1))
      .send({ cantidadDisponible: 50, cantidadReservada: 999, productoId: 123 });

    expect(response.status).toBe(200);
    expect(updateById).toHaveBeenCalledWith('7', { cantidadDisponible: 50 });
  });

  it('lets a buyer update their OWN order delivery point', async () => {
    jest.spyOn(OrdenRepository.prototype, 'findById')
      .mockResolvedValue({ id: 5, compradorId: 1, estado: 'pendiente' });
    const updateById = jest.spyOn(OrdenRepository.prototype, 'updateById')
      .mockResolvedValue({ id: 5, puntoEntrega: 'Anexo' });
    const { app } = buildApp();
    const response = await request(app)
      .patch('/api/ordenes/5')
      .set(authAs(1))
      .send({ puntoEntrega: 'Anexo' });

    expect(response.status).toBe(200);
    expect(updateById).toHaveBeenCalledWith('5', { puntoEntrega: 'Anexo' });
  });

  it('forbids modifying another user’s order, including payment state', async () => {
    jest.spyOn(OrdenRepository.prototype, 'findById')
      .mockResolvedValue({ id: 5, compradorId: 2, estado: 'pendiente' });
    const updateById = jest.spyOn(OrdenRepository.prototype, 'updateById');
    const { app } = buildApp();
    const response = await request(app)
      .patch('/api/ordenes/5')
      .set(authAs(1))
      .send({ puntoEntrega: 'X', estado: 'pagada' });

    expect(response.status).toBe(403);
    expect(updateById).not.toHaveBeenCalled();
  });

  it('strips payment fields smuggled into an order update', async () => {
    jest.spyOn(OrdenRepository.prototype, 'findById')
      .mockResolvedValue({ id: 5, compradorId: 1, estado: 'pendiente' });
    const updateById = jest.spyOn(OrdenRepository.prototype, 'updateById')
      .mockResolvedValue({ id: 5, puntoEntrega: 'Anexo' });
    const { app } = buildApp();
    const response = await request(app)
      .patch('/api/ordenes/5')
      .set(authAs(1))
      .send({ puntoEntrega: 'Anexo', estado: 'pagada', descuento: 0 });

    expect(response.status).toBe(200);
    expect(updateById).toHaveBeenCalledWith('5', { puntoEntrega: 'Anexo' });
  });

  it('restricts notification updates to the recipient', async () => {
    const findById = jest.spyOn(CrudRepository.prototype, 'findById');
    const updateById = jest.spyOn(CrudRepository.prototype, 'updateById')
      .mockResolvedValue({ id: 4, enviada: true });
    const { app } = buildApp();

    findById.mockResolvedValue({ id: 4, usuarioId: 1 });
    const own = await request(app)
      .patch('/api/notificaciones/4')
      .set(authAs(1))
      .send({ enviada: true, usuarioId: 2 });
    expect(own.status).toBe(200);
    expect(updateById).toHaveBeenCalledWith('4', { enviada: true });

    findById.mockResolvedValue({ id: 4, usuarioId: 2 });
    const foreign = await request(app)
      .patch('/api/notificaciones/4')
      .set(authAs(1))
      .send({ enviada: true });
    expect(foreign.status).toBe(403);
    expect(updateById).toHaveBeenCalledTimes(1);
  });

  it('restricts stock-follow updates to the follower', async () => {
    const findById = jest.spyOn(CrudRepository.prototype, 'findById');
    const updateById = jest.spyOn(CrudRepository.prototype, 'updateById')
      .mockResolvedValue({ id: 6, activo: false });
    const { app } = buildApp();

    findById.mockResolvedValue({ id: 6, usuarioId: 1 });
    const own = await request(app)
      .patch('/api/seguimiento-stock/6')
      .set(authAs(1))
      .send({ activo: false });
    expect(own.status).toBe(200);

    findById.mockResolvedValue({ id: 6, usuarioId: 2 });
    const foreign = await request(app)
      .patch('/api/seguimiento-stock/6')
      .set(authAs(1))
      .send({ activo: false });
    expect(foreign.status).toBe(403);
    expect(updateById).toHaveBeenCalledTimes(1);
  });

  it('forces stock-follows to be created for the caller', async () => {
    const create = jest.spyOn(CrudRepository.prototype, 'create')
      .mockResolvedValue({ id: 6, usuarioId: 1 });
    const { app } = buildApp();
    const response = await request(app)
      .post('/api/seguimiento-stock')
      .set(authAs(1))
      .send({ usuarioId: 99, productoId: 9, activo: true });

    expect(response.status).toBe(201);
    expect(create).toHaveBeenCalledWith({ usuarioId: 1, productoId: 9, activo: true });
  });
});

describe('seller publishing (converted dual role)', () => {
  const OLD_ENV = process.env;
  const validBody = {
    categoriaId: 2,
    nombre: 'Laptop',
    descripcion: 'Equipo de cómputo',
    precio: 15000,
    cantidadDisponible: 3,
  };

  beforeEach(() => {
    process.env = { ...OLD_ENV, NODE_ENV: 'test', JWT_SECRET };
    jest.spyOn(ProductoRepository.prototype, 'countByVendedor').mockResolvedValue(0);
    jest.spyOn(ProductoRepository.prototype, 'create')
      .mockImplementation(async (data) => ({ id: 5, ...data }));
    jest.spyOn(InventarioRepository.prototype, 'save').mockResolvedValue({});
  });

  afterEach(() => {
    process.env = OLD_ENV;
    jest.restoreAllMocks();
  });

  it('a converted seller (rol dual) can publish through POST /api/productos', async () => {
    jest.spyOn(UsuarioRepository.prototype, 'findById')
      .mockResolvedValue({ id: 1, rol: 'dual', plan: 'free' });
    const { app } = buildApp();
    const response = await request(app)
      .post('/api/productos')
      .set(authAs(1))
      .send(validBody);

    expect(response.status).toBe(201);
    expect(ProductoRepository.prototype.create).toHaveBeenCalledWith(
      expect.objectContaining({ vendedorId: 1 }),
    );
  });

  it('a buyer cannot publish (route guard rejects before the use-case)', async () => {
    jest.spyOn(UsuarioRepository.prototype, 'findById')
      .mockResolvedValue({ id: 1, rol: 'comprador', plan: 'free' });
    const { app } = buildApp();
    const response = await request(app)
      .post('/api/productos')
      .set(authAs(1))
      .send(validBody);

    expect(response.status).toBe(403);
    expect(ProductoRepository.prototype.create).not.toHaveBeenCalled();
  });

  it('a forged vendedorId cannot impersonate another seller', async () => {
    jest.spyOn(UsuarioRepository.prototype, 'findById')
      .mockResolvedValue({ id: 1, rol: 'vendedor', plan: 'premium' });
    const { app } = buildApp();
    const response = await request(app)
      .post('/api/productos')
      .set(authAs(1))
      .send({ ...validBody, vendedorId: 2 });

    expect(response.status).toBe(201);
    // mapCreateBody overwrites the body's vendedorId with the JWT subject.
    expect(ProductoRepository.prototype.create).toHaveBeenCalledWith(
      expect.objectContaining({ vendedorId: 1 }),
    );
    expect(ProductoRepository.prototype.create).not.toHaveBeenCalledWith(
      expect.objectContaining({ vendedorId: 2 }),
    );
  });
});
