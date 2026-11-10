const EventBus = require('../../../domain/events/EventBus');
const Inventario = require('../../../domain/entities/Inventario');
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
