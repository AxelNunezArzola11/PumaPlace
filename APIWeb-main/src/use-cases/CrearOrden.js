const Orden = require('../domain/entities/Orden');
const { EVENTS } = require('../domain/events/EventBus');

class CrearOrden {
  constructor({ carritoRepository, productoRepository, ordenRepository, eventBus } = {}) {
    if (!carritoRepository || !productoRepository || !ordenRepository || !eventBus) {
      throw new Error('CrearOrden requiere repositorios y EventBus');
    }
    this.carritoRepository = carritoRepository;
    this.productoRepository = productoRepository;
    this.ordenRepository = ordenRepository;
    this.eventBus = eventBus;
  }

  async execute({ usuarioId, puntoEntrega = null, descuento = 0 }) {
    const carrito = await this.carritoRepository.findActiveByUsuarioId(usuarioId);
    if (!carrito || !carrito.items?.length) throw new Error('El carrito está vacío');
    const orden = new Orden({ compradorId: usuarioId, puntoEntrega, descuento });
    for (const item of carrito.items) {
      const producto = await this.productoRepository.findById(item.productoId);
      if (!producto) throw new Error(`Producto no encontrado: ${item.productoId}`);
      orden.agregarLinea(producto.id, item.cantidad, Number(producto.precio));
    }
    const total = orden.calcularTotal();
    const result = await this.ordenRepository.create({
      compradorId: orden.compradorId,
      puntoEntrega: orden.puntoEntrega,
      descuento: orden.descuento,
      estado: orden.estado,
      lineas: orden.lineas,
    });
    await this.carritoRepository.save({ id: carrito.id, usuarioId, items: carrito.items, estado: 'convertido' });
    this.eventBus.publish(EVENTS.ORDER_CREATED, { orden: result });
    return { ...result, total };
  }
}

module.exports = CrearOrden;
