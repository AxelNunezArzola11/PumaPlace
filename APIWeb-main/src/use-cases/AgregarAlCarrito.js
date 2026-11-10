const Carrito = require('../domain/entities/Carrito');

class AgregarAlCarrito {
  constructor({ carritoRepository } = {}) {
    if (!carritoRepository) throw new Error('AgregarAlCarrito requiere un repositorio');
    this.carritoRepository = carritoRepository;
  }

  async execute({ usuarioId, productoId, cantidad = 1 }) {
    let data = await this.carritoRepository.findActiveByUsuarioId(usuarioId);
    const carrito = data ? new Carrito(data) : new Carrito({ usuarioId });
    carrito.agregarItem(productoId, cantidad);
    data = await this.carritoRepository.save({
      id: carrito.id,
      usuarioId: carrito.usuarioId,
      items: carrito.items,
      estado: carrito.estado,
    });
    return data;
  }
}

module.exports = AgregarAlCarrito;
