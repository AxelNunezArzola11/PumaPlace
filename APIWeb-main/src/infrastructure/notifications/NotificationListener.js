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
  constructor({ eventBus, notificacionModel = NotificacionModel } = {}) {
    if (!eventBus) throw new Error('NotificationListener requiere un EventBus');
    this.notificacionModel = notificacionModel;
    this.unsubscribe = Object.values(EVENTS).map((eventName) =>
      eventBus.subscribe(eventName, (payload) => this.notify(eventName, payload)));
  }

  async notify(eventName, payload = {}) {
    if (eventName === EVENTS.ORDER_PAID) {
      return this.notifySellers(payload);
    }
    const data = notificationFor(eventName, payload);
    if (!data) return null;
    const notificacion = new Notificacion(data);
    return this.notificacionModel.create({
      usuarioId: notificacion.usuarioId,
      tipo: notificacion.tipo,
      mensaje: notificacion.mensaje,
      fecha: notificacion.fecha,
      enviada: notificacion.enviada,
    });
  }

  async notifySellers(payload) {
    const lineas = payload.orden?.lineas || [];
    const sellerIds = new Set();
    for (const linea of lineas) {
      const producto = await ProductoModel.findByPk(linea.productoId, {
        attributes: ['vendedorId', 'nombre'],
      });
      if (producto?.vendedorId) sellerIds.add(String(producto.vendedorId));
    }

    const notifications = [];
    for (const vendedorId of sellerIds) {
      const notificacion = new Notificacion({
        usuarioId: Number(vendedorId),
        tipo: 'venta',
        mensaje: `Tienes una nueva venta. Debes procesarla dentro de 3 horas.`,
      });
      notifications.push(this.notificacionModel.create({
        usuarioId: notificacion.usuarioId,
        tipo: notificacion.tipo,
        mensaje: notificacion.mensaje,
        fecha: notificacion.fecha,
        enviada: notificacion.enviada,
      }));
    }
    return Promise.all(notifications);
  }

  close() {
    this.unsubscribe.forEach((unsubscribe) => unsubscribe());
  }
}

module.exports = NotificationListener;
