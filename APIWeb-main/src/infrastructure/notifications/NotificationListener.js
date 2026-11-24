const Notificacion = require('../../domain/entities/Notificacion');
const { EVENTS } = require('../../domain/events/EventBus');
const NotificacionModel = require('../models/Notificacion');
const ProductoModel = require('../models/Producto');

const notificationFor = (eventName, payload) => {
  const userId = payload.usuarioId || payload.compradorId || payload.usuario?.id;
  if (!userId) return null;

  const types = {
    [EVENTS.CART_ABANDONED]: ['carrito_abandonado', 'Tu carrito tiene productos pendientes.'],
    [EVENTS.STOCK_REPLENISHED]: ['reabastecimiento', 'Un producto que sigues volvió a tener existencias.'],
    [EVENTS.SUBSCRIPTION_EXPIRING]: ['inactividad', 'Tu suscripción premium está próxima a vencer.'],
  };
  const [tipo, mensaje] = types[eventName] || ['otro', `Actualización de la operación: ${eventName}.`];
  return { usuarioId: userId, tipo, mensaje };
};

class NotificationListener {
  constructor({
    eventBus,
    notificacionModel = NotificacionModel,
    productoModel = ProductoModel,
    logger = console,
  } = {}) {
    if (!eventBus) throw new Error('NotificationListener requiere un EventBus');
    this.notificacionModel = notificacionModel;
    this.productoModel = productoModel;
    this.logger = logger;
    this.notifiedOrderSellers = new Set();
    this.unsubscribe = Object.values(EVENTS).map((eventName) =>
      eventBus.subscribe(eventName, (payload) => this.notify(eventName, payload)));
  }

  async notify(eventName, payload = {}) {
    try {
      if (eventName === EVENTS.ORDER_PAID) {
        return await this.notifySellers(payload);
      }
      const data = notificationFor(eventName, payload);
      if (!data) return null;
      const notificacion = new Notificacion(data);
      return await this.notificacionModel.create({
        usuarioId: notificacion.usuarioId,
        tipo: notificacion.tipo,
        mensaje: notificacion.mensaje,
        fecha: notificacion.fecha,
        enviada: notificacion.enviada,
      });
    } catch (error) {
      this.logger.error(`[notificaciones] fallo al crear notificación (${eventName}): ${error.message}`);
      return null;
    }
  }

  async notifySellers(payload = {}) {
    const orden = payload.orden || {};
    const orderId = orden.id ?? payload.ordenId ?? null;
    const lineas = Array.isArray(orden.lineas) ? orden.lineas : [];
    const sellerIds = new Set();

    for (const linea of lineas) {
      if (linea?.vendedorId) {
        sellerIds.add(String(linea.vendedorId));
        continue;
      }
      if (!linea?.productoId) continue;
      try {
        const producto = await this.productoModel.findByPk(linea.productoId, {
          attributes: ['vendedorId', 'nombre'],
        });
        if (producto?.vendedorId) sellerIds.add(String(producto.vendedorId));
      } catch (error) {
        this.logger.error(
          `[notificaciones] fallo al consultar vendedor de producto ${linea.productoId} (orden ${orderId ?? 'sin-id'}): ${error.message}`,
        );
      }
    }

    const created = [];
    for (const vendedorId of sellerIds) {
      const dedupKey = orderId != null ? `${orderId}:${vendedorId}` : null;
      if (dedupKey && this.notifiedOrderSellers.has(dedupKey)) continue;

      try {
        const notificacion = new Notificacion({
          usuarioId: Number(vendedorId),
          tipo: 'venta',
          mensaje: 'Tienes una nueva venta. Debes procesarla dentro de 3 horas.',
        });
        const record = await this.notificacionModel.create({
          usuarioId: notificacion.usuarioId,
          tipo: notificacion.tipo,
          mensaje: notificacion.mensaje,
          fecha: notificacion.fecha,
          enviada: notificacion.enviada,
        });
        if (dedupKey) this.notifiedOrderSellers.add(dedupKey);
        created.push(record);
      } catch (error) {
        this.logger.error(
          `[notificaciones] fallo al notificar venta al vendedor ${vendedorId} (orden ${orderId ?? 'sin-id'}): ${error.message}`,
        );
      }
    }
    return created;
  }

  close() {
    this.unsubscribe.forEach((unsubscribe) => unsubscribe());
  }
}

module.exports = NotificationListener;
