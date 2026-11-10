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
    const producto = await this.productoRepository.create({
      vendedorId: data.vendedorId,
      categoriaId: data.categoriaId,
      nombre: data.nombre,
      descripcion: data.descripcion,
      precio: data.precio,
      estado: 'publicado',
    });
    if (this.inventarioRepository) {
      await this.inventarioRepository.save({
        productoId: producto.id,
        cantidadDisponible: data.cantidadDisponible || 0,
        cantidadReservada: 0,
      });
    }
    return producto;
  }
}

module.exports = PublicarProducto;
