const { EventEmitter } = require('events');

const EVENTS = Object.freeze({
  ORDER_CREATED: 'OrderCreated',
  ORDER_PAID: 'OrderPaid',
  ORDER_CANCELLED: 'OrderCancelled',
  CART_ABANDONED: 'CartAbandoned',
  STOCK_REPLENISHED: 'StockReplenished',
  SUBSCRIPTION_UPGRADED: 'SubscriptionUpgraded',
  SUBSCRIPTION_EXPIRING: 'SubscriptionExpiring',
});

class EventBus extends EventEmitter {
  publish(eventName, payload = {}) {
    if (!Object.values(EVENTS).includes(eventName)) {
      throw new Error(`Evento no registrado: ${eventName}`);
    }
    return this.emit(eventName, payload);
  }

  subscribe(eventName, listener) {
    if (!Object.values(EVENTS).includes(eventName)) {
      throw new Error(`Evento no registrado: ${eventName}`);
    }
    if (typeof listener !== 'function') {
      throw new TypeError('El listener debe ser una función');
    }
    this.on(eventName, listener);
    return () => this.off(eventName, listener);
  }
}

EventBus.EVENTS = EVENTS;

module.exports = EventBus;
