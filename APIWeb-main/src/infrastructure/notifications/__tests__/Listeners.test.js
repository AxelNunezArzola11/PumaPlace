const EventBus = require('../../../domain/events/EventBus');
const Inventario = require('../../../domain/entities/Inventario');
const NotificacionEntity = require('../../../domain/entities/Notificacion');
const NotificacionModel = require('../../models/Notificacion');
const InventoryListener = require('../InventoryListener');
const NotificationListener = require('../NotificationListener');
const AnalyticsListener = require('../AnalyticsListener');

describe('InventoryListener', () => {
  const inventoryRecord = (data) => ({
    ...data,
    toJSON: () => ({ ...data }),
    update: jest.fn().mockResolvedValue(undefined),
  });

  it('reserva stock al crear una orden', async () => {
    const eventBus = new EventBus();
    const record = inventoryRecord({ productoId: 10, cantidadDisponible: 5, cantidadReservada: 0 });
    const model = { findOne: jest.fn().mockResolvedValue(record) };
    const listener = new InventoryListener({ eventBus, inventarioModel: model });

    await listener.reserve({ orden: { lineas: [{ productoId: 10, cantidad: 2 }] } });

    expect(record.update).toHaveBeenCalledWith({ cantidadDisponible: 3, cantidadReservada: 2 });
    listener.close();
  });

  it('libera stock al cancelar una orden', async () => {
    const eventBus = new EventBus();
    const record = inventoryRecord({ productoId: 10, cantidadDisponible: 3, cantidadReservada: 2 });
    const model = { findOne: jest.fn().mockResolvedValue(record) };
    const listener = new InventoryListener({ eventBus, inventarioModel: model });

    await listener.release({ orden: { lineas: [{ productoId: 10, cantidad: 2 }] } });

    expect(record.update).toHaveBeenCalledWith({ cantidadDisponible: 5, cantidadReservada: 0 });
    listener.close();
  });

  it('consume la reserva cuando la orden se paga', async () => {
    const eventBus = new EventBus();
    const record = inventoryRecord({ productoId: 10, cantidadDisponible: 3, cantidadReservada: 2 });
    const model = { findOne: jest.fn().mockResolvedValue(record) };
    const listener = new InventoryListener({ eventBus, inventarioModel: model });

    await listener.commit({ orden: { lineas: [{ productoId: 10, cantidad: 2 }] } });

    expect(record.update).toHaveBeenCalledWith({ cantidadDisponible: 3, cantidadReservada: 0 });
    listener.close();
  });

  it('rechaza reservar si no existe inventario', async () => {
    const eventBus = new EventBus();
    const listener = new InventoryListener({
      eventBus,
      inventarioModel: { findOne: jest.fn().mockResolvedValue(null) },
    });

    await expect(listener.reserve({ lineas: [{ productoId: 10, cantidad: 1 }] }))
      .rejects.toThrow(/inventario/i);
    listener.close();
  });
});

describe('NotificationListener', () => {
  it('crea una notificación de carrito abandonado', async () => {
    const eventBus = new EventBus();
    const model = { create: jest.fn().mockResolvedValue({ id: 1 }) };
    const listener = new NotificationListener({ eventBus, notificacionModel: model });

    await listener.notify(EventBus.EVENTS.CART_ABANDONED, { usuarioId: 7 });

    expect(model.create).toHaveBeenCalledWith(expect.objectContaining({
      usuarioId: 7,
      tipo: 'carrito_abandonado',
    }));
    listener.close();
  });

  it('mantiene sincronizados los tipos válidos entre la entidad y el modelo Sequelize (incluyendo venta)', () => {
    expect(NotificacionEntity.TIPOS_VALIDOS).toEqual([
      'carrito_abandonado',
      'reabastecimiento',
      'inactividad',
      'otro',
      'venta',
    ]);
    expect(NotificacionModel.rawAttributes.tipo.values).toEqual([...NotificacionEntity.TIPOS_VALIDOS]);
  });

  it('notifica venta a múltiples vendedores de una orden pagada sin duplicar por vendedor', async () => {
    const eventBus = new EventBus();
    const logger = { error: jest.fn() };
    const model = { create: jest.fn().mockImplementation(async (data) => ({ id: 10, ...data })) };
    const productoModel = {
      findByPk: jest.fn()
        .mockResolvedValueOnce({ vendedorId: 4000001, nombre: 'Prod A' })
        .mockResolvedValueOnce({ vendedorId: 4000002, nombre: 'Prod B' })
        .mockResolvedValueOnce({ vendedorId: 4000001, nombre: 'Prod C' }),
    };
    const listener = new NotificationListener({
      eventBus,
      notificacionModel: model,
      productoModel,
      logger,
    });

    const created = await listener.notify(EventBus.EVENTS.ORDER_PAID, {
      orden: {
        id: 354560,
        lineas: [{ productoId: 1 }, { productoId: 2 }, { productoId: 3 }],
      },
    });

    expect(created).toHaveLength(2);
    expect(model.create).toHaveBeenNthCalledWith(1, expect.objectContaining({
      usuarioId: 4000001,
      tipo: 'venta',
    }));
    expect(model.create).toHaveBeenNthCalledWith(2, expect.objectContaining({
      usuarioId: 4000002,
      tipo: 'venta',
    }));
    expect(logger.error).not.toHaveBeenCalled();
    listener.close();
  });

  it('aísla fallos de base de datos sin propagar rechazo ni impedir notificar a otros vendedores', async () => {
    const logger = { error: jest.fn(), log: jest.fn() };
    const eventBus = new EventBus({ logger });
    const dbError = new Error("Data truncated for column 'tipo' at row 1");
    const model = {
      create: jest.fn()
        .mockRejectedValueOnce(dbError)
        .mockResolvedValueOnce({ id: 2, usuarioId: 4000002, tipo: 'venta' }),
    };
    const productoModel = {
      findByPk: jest.fn()
        .mockResolvedValueOnce({ vendedorId: 4000001 })
        .mockResolvedValueOnce({ vendedorId: 4000002 }),
    };
    const listener = new NotificationListener({
      eventBus,
      notificacionModel: model,
      productoModel,
      logger,
    });

    const created = await listener.notify(EventBus.EVENTS.ORDER_PAID, {
      orden: { id: 354559, lineas: [{ productoId: 1 }, { productoId: 2 }] },
    });

    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ usuarioId: 4000002, tipo: 'venta' });
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('4000001'));
    expect(logger.log).not.toHaveBeenCalled();

    // Publicar vía EventBus tampoco genera rechazo no manejado
    model.create.mockRejectedValueOnce(dbError);
    expect(() => eventBus.publish(EventBus.EVENTS.ORDER_PAID, {
      orden: { id: 354561, lineas: [{ productoId: 1 }] },
    })).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(logger.error).toHaveBeenCalled();
    listener.close();
  });

  it('maneja tipos de notificación inválidos de forma segura sin lanzar excepción', async () => {
    const eventBus = new EventBus();
    const logger = { error: jest.fn() };
    const model = { create: jest.fn() };
    const listener = new NotificationListener({ eventBus, notificacionModel: model, logger });

    const originalPublishError = await listener.notify('EventoDesconocido', {});
    expect(originalPublishError).toBeNull();

    // Validación directa de entidad rechaza tipos inválidos
    expect(() => new NotificacionEntity({ usuarioId: 1, tipo: 'invalido', mensaje: 'x' })).toThrow(/inválido/);
    listener.close();
  });

  it('evita notificaciones duplicadas para la misma orden y vendedor pero permite reintentar si falló', async () => {
    const eventBus = new EventBus();
    const logger = { error: jest.fn() };
    const model = {
      create: jest.fn()
        .mockRejectedValueOnce(new Error('DB transient error'))
        .mockResolvedValue({ id: 5, usuarioId: 4000001, tipo: 'venta' }),
    };
    const productoModel = { findByPk: jest.fn().mockResolvedValue({ vendedorId: 4000001 }) };
    const listener = new NotificationListener({
      eventBus,
      notificacionModel: model,
      productoModel,
      logger,
    });

    const payload = { orden: { id: 354560, lineas: [{ productoId: 1 }] } };
    const first = await listener.notify(EventBus.EVENTS.ORDER_PAID, payload);
    expect(first).toHaveLength(0);

    // Segundo intento tras fallo sí crea la notificación
    const second = await listener.notify(EventBus.EVENTS.ORDER_PAID, payload);
    expect(second).toHaveLength(1);
    expect(model.create).toHaveBeenCalledTimes(2);

    // Tercer intento duplicado se omite porque ya se notificó con éxito
    const third = await listener.notify(EventBus.EVENTS.ORDER_PAID, payload);
    expect(third).toHaveLength(0);
    expect(model.create).toHaveBeenCalledTimes(2);
    listener.close();
  });
});

describe('AnalyticsListener', () => {
  it('registra cada evento publicado', () => {
    const eventBus = new EventBus();
    const logger = { log: jest.fn() };
    const listener = new AnalyticsListener({ eventBus, logger });

    eventBus.publish(EventBus.EVENTS.ORDER_PAID, { ordenId: 3 });

    expect(logger.log).toHaveBeenCalledWith('[analytics] OrderPaid', { ordenId: 3 });
    listener.close();
  });
});

describe('Listener dependencies', () => {
  it('mantiene la entidad de inventario independiente de Sequelize', () => {
    expect(Inventario.toString()).not.toMatch(/sequelize/i);
  });
});
