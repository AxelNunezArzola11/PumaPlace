const Inventario = require('../../domain/entities/Inventario');
const { EVENTS } = require('../../domain/events/EventBus');
const InventarioModel = require('../models/Inventario');

const getOrder = (payload) => payload.orden || payload.order || payload;

class InventoryListener {
  constructor({ eventBus, inventarioModel = InventarioModel } = {}) {
    if (!eventBus) throw new Error('InventoryListener requiere un EventBus');
    this.inventarioModel = inventarioModel;
    this.unsubscribe = [
      eventBus.subscribe(EVENTS.ORDER_CREATED, (payload) => this.reserve(payload)),
      eventBus.subscribe(EVENTS.ORDER_CANCELLED, (payload) => this.release(payload)),
    ];
  }

  async reserve(payload) {
    const order = getOrder(payload);
    for (const linea of order.lineas || []) {
      const registro = await this.inventarioModel.findOne({ where: { productoId: linea.productoId } });
      if (!registro) {
        throw new Error(`No existe inventario para el producto ${linea.productoId}`);
      }
      const inventario = new Inventario(registro.toJSON ? registro.toJSON() : registro);
      inventario.reservarStock(linea.cantidad);
      await registro.update({
        cantidadDisponible: inventario.cantidadDisponible,
        cantidadReservada: inventario.cantidadReservada,
      });
    }
  }

  async release(payload) {
    const order = getOrder(payload);
    for (const linea of order.lineas || []) {
      const registro = await this.inventarioModel.findOne({ where: { productoId: linea.productoId } });
      if (!registro) {
        throw new Error(`No existe inventario para el producto ${linea.productoId}`);
      }
      const inventario = new Inventario(registro.toJSON ? registro.toJSON() : registro);
      inventario.liberarStock(linea.cantidad);
      await registro.update({
        cantidadDisponible: inventario.cantidadDisponible,
        cantidadReservada: inventario.cantidadReservada,
      });
    }
  }

  close() {
    this.unsubscribe.forEach((unsubscribe) => unsubscribe());
  }
}

module.exports = InventoryListener;
