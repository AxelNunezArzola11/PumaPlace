const Carrito = require('../domain/entities/Carrito');

const normalizarItems = (items) => {
  const cantidades = new Map();
  for (const item of items) {
    const productoId = Number(item?.productoId);
    const cantidad = Number(item?.cantidad);
    if (!Number.isSafeInteger(productoId) || productoId <= 0) {
      throw new Error('Cada artículo debe tener un productoId válido');
    }
    if (!Number.isSafeInteger(cantidad) || cantidad <= 0) {
      throw new Error('La cantidad de cada artículo debe ser mayor a 0');
    }
    cantidades.set(productoId, (cantidades.get(productoId) || 0) + cantidad);
  }
  return [...cantidades.entries()].map(([productoId, cantidad]) => ({ productoId, cantidad }));
};

class SincronizarCarrito {
  constructor({ carritoRepository, productoRepository, inventarioRepository } = {}) {
    if (!carritoRepository) throw new Error('SincronizarCarrito requiere un repositorio');
    this.carritoRepository = carritoRepository;
    this.productoRepository = productoRepository;
    this.inventarioRepository = inventarioRepository;
  }

  async execute({ usuarioId, items }) {
    if (!Array.isArray(items) || items.length === 0) {
      throw new Error('El carrito está vacío');
    }
    const normalizados = normalizarItems(items);

    for (const item of normalizados) {
      if (this.productoRepository) {
        const producto = await this.productoRepository.findById(item.productoId);
        if (!producto) throw new Error(`Producto no encontrado: ${item.productoId}`);
        if (String(producto.vendedorId) === String(usuarioId)) {
          throw new Error('No puedes comprar tus propios productos');
        }
        if (producto.estado && producto.estado !== 'publicado') {
          throw new Error(`El producto ${item.productoId} no está disponible para comprar`);
        }
      }
      if (this.inventarioRepository) {
        const inventario = await this.inventarioRepository.findByProductoId(item.productoId);
        const disponible = Number(inventario?.cantidadDisponible ?? 0);
        if (disponible < item.cantidad) {
          const error = new Error(`No hay suficiente stock para el producto ${item.productoId} (disponibles: ${disponible})`);
          error.status = 422;
          error.type = 'REGLA_DE_NEGOCIO';
          throw error;
        }
      }
    }

    let data = await this.carritoRepository.findActiveByUsuarioId(usuarioId);
    const carrito = data ? new Carrito(data) : new Carrito({ usuarioId });
    carrito.items = normalizados;

    return this.carritoRepository.save({
      id: carrito.id,
      usuarioId: carrito.usuarioId,
      items: carrito.items,
      estado: carrito.estado,
    });
  }
}

module.exports = SincronizarCarrito;
