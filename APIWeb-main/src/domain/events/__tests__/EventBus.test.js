const EventBus = require('../EventBus');

describe('EventBus', () => {
  it('publica eventos registrados a sus suscriptores', () => {
    const bus = new EventBus();
    const listener = jest.fn();
    bus.subscribe(EventBus.EVENTS.ORDER_CREATED, listener);

    bus.publish(EventBus.EVENTS.ORDER_CREATED, { ordenId: 1 });

    expect(listener).toHaveBeenCalledWith({ ordenId: 1 });
  });

  it('permite retirar una suscripción', () => {
    const bus = new EventBus();
    const listener = jest.fn();
    const unsubscribe = bus.subscribe(EventBus.EVENTS.ORDER_PAID, listener);
    unsubscribe();

    bus.publish(EventBus.EVENTS.ORDER_PAID);

    expect(listener).not.toHaveBeenCalled();
  });

  it('rechaza eventos desconocidos y listeners inválidos', () => {
    const bus = new EventBus();
    expect(() => bus.publish('UnknownEvent')).toThrow(/no registrado/i);
    expect(() => bus.subscribe(EventBus.EVENTS.ORDER_PAID, null)).toThrow(/listener/i);
  });
});
