const Carrito = require('../domain/entities/Carrito');

class AgregarAlCarrito {
  constructor({ carritoRepository, productoRepository = null, inventarioRepository = null } = {}) {
    if (!carritoRepository) throw new Error('AgregarAlCarrito requiere un repositorio');
    this.carritoRepository = carritoRepository;
    this.productoRepository = productoRepository;
    this.inventarioRepository = inventarioRepository;
  }

  async execute({ usuarioId, productoId, cantidad = 1 }) {
    const productoIdNum = Number(productoId);
    const cantidadNum = Number(cantidad);
    if (!Number.isSafeInteger(productoIdNum) || productoIdNum <= 0) {
      throw new Error('El productoId debe ser un número válido');
    }
    if (!Number.isSafeInteger(cantidadNum) || cantidadNum <= 0) {
      throw new Error('La cantidad debe ser un entero mayor a 0');
    }

    let data = await this.carritoRepository.findActiveByUsuarioId(usuarioId);
    const carrito = data ? new Carrito(data) : new Carrito({ usuarioId });

    if (this.productoRepository) {
      const producto = await this.productoRepository.findById(productoIdNum);
      if (!producto) throw new Error('Producto no encontrado');
      if (String(producto.vendedorId) === String(usuarioId)) {
        throw new Error('No puedes agregar tus propios productos al carrito');
      }
      if (producto.estado && producto.estado !== 'publicado') {
        throw new Error('El producto no está disponible para comprar');
      }

      if (this.inventarioRepository || producto.inventario) {
        const inventario = producto.inventario
          || await this.inventarioRepository.findByProductoId(productoIdNum);
        const disponible = Number(inventario?.cantidadDisponible ?? 0);
        const yaEnCarrito = carrito.items
          .filter((item) => String(item.productoId) === String(productoIdNum))
          .reduce((total, item) => total + Number(item.cantidad || 0), 0);
        if (disponible < yaEnCarrito + cantidadNum) {
          const error = new Error(`No hay suficiente stock disponible (disponibles: ${Math.max(0, disponible - yaEnCarrito)})`);
          error.status = 422;
          error.type = 'REGLA_DE_NEGOCIO';
          throw error;
        }
      }
    }

    carrito.agregarItem(productoIdNum, cantidadNum);
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
