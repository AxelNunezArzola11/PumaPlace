const EventBus = require('../../../domain/events/EventBus');
const InventoryListener = require('../InventoryListener');

describe('InventoryListener payment transitions', () => {
  it('does not commit or release the same order twice', async () => {
    const record = {
      cantidadDisponible: 0,
      cantidadReservada: 2,
      toJSON() { return this; },
      update: jest.fn(async (changes) => Object.assign(record, changes)),
    };
    const model = { findOne: jest.fn().mockResolvedValue(record) };
    const listener = new InventoryListener({ eventBus: new EventBus(), inventarioModel: model });
    const order = { id: 3, lineas: [{ productoId: 9, cantidad: 2 }] };

    await listener.commit({ orden: order });
    await listener.commit({ orden: order });
    expect(record.update).toHaveBeenCalledTimes(1);
    expect(record.cantidadReservada).toBe(0);

    await listener.release({ orden: order });
    expect(record.update).toHaveBeenCalledTimes(1);
  });
});
