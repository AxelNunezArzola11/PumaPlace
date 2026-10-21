const Notificacion = require('../../domain/entities/Notificacion');
const { EVENTS } = require('../../domain/events/EventBus');
const NotificacionModel = require('../models/Notificacion');

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

  close() {
    this.unsubscribe.forEach((unsubscribe) => unsubscribe());
  }
}

module.exports = NotificationListener;
