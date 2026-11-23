const Carrito = require('../domain/entities/Carrito');
const { EVENTS } = require('../domain/events/EventBus');

class AbandonarCarrito {
  constructor({ carritoRepository, eventBus } = {}) {
    if (!carritoRepository || !eventBus) throw new Error('AbandonarCarrito requiere repositorio y EventBus');
    this.carritoRepository = carritoRepository;
    this.eventBus = eventBus;
  }

  async execute(carritoId) {
    const data = await this.carritoRepository.findById(carritoId);
    if (!data) throw new Error('Carrito no encontrado');
    const carrito = new Carrito(data);
    carrito.abandonar();
    const result = await this.carritoRepository.save({
      id: carrito.id,
      usuarioId: carrito.usuarioId,
      items: carrito.items,
      estado: carrito.estado,
    });
    this.eventBus.publish(EVENTS.CART_ABANDONED, { carrito: result, usuarioId: carrito.usuarioId });
    return result;
  }
}

module.exports = AbandonarCarrito;
