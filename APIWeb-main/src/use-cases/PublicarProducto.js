class PublicarProducto {
  constructor({ usuarioRepository, productoRepository, inventarioRepository } = {}) {
    if (!usuarioRepository || !productoRepository) {
      throw new Error('PublicarProducto requiere repositorios de usuario y producto');
    }
    this.usuarioRepository = usuarioRepository;
    this.productoRepository = productoRepository;
    this.inventarioRepository = inventarioRepository;
  }

  async execute(data) {
    const usuario = await this.usuarioRepository.findById(data.vendedorId);
    if (!usuario) throw new Error('Usuario no encontrado');
    if (usuario.rol !== 'vendedor') throw new Error('El usuario no es vendedor');
    const count = await this.productoRepository.countByVendedor(data.vendedorId);
    if (usuario.plan === 'free' && count >= 5) {
      throw new Error('El plan free permite publicar hasta 5 productos');
    }

    const nombre = typeof data.nombre === 'string' ? data.nombre.trim() : '';
    const descripcion = typeof data.descripcion === 'string' ? data.descripcion.trim() : '';
    const precio = Number(data.precio);
    const cantidadDisponible = Number(data.cantidadDisponible);
    const categoriaId = Number(data.categoriaId);

    if (!nombre) throw new Error('El nombre del producto es obligatorio');
    if (nombre.length > 150) throw new Error('El nombre del producto no puede superar 150 caracteres');
    if (!descripcion) throw new Error('La descripción del producto es obligatoria');
    if (!Number.isFinite(precio) || precio <= 0) throw new Error('El precio debe ser mayor a 0');
    if (!Number.isSafeInteger(cantidadDisponible) || cantidadDisponible <= 0) {
      throw new Error('El producto debe tener al menos 1 unidad en stock');
    }
    if (!Number.isSafeInteger(categoriaId) || categoriaId <= 0) {
      throw new Error('La categoría del producto es obligatoria');
    }

    const producto = await this.productoRepository.create({
      vendedorId: data.vendedorId,
      categoriaId,
      nombre,
      descripcion,
      precio,
      imagenUrl: data.imagenUrl || null,
      estado: 'publicado',
    });
    if (this.inventarioRepository) {
      await this.inventarioRepository.save({
        productoId: producto.id,
        cantidadDisponible,
        cantidadReservada: 0,
      });
    }
    return producto;
  }
}

module.exports = PublicarProducto;
