const Cupon = require('../domain/entities/Cupon');

class GenerarCuponPorInactividad {
  constructor({ cuponRepository } = {}) {
    if (!cuponRepository) throw new Error('GenerarCuponPorInactividad requiere un repositorio');
    this.cuponRepository = cuponRepository;
  }

  async execute(usuarioId, descuento = 10) {
    const cupon = Cupon.generarPorInactividad(usuarioId, descuento);
    return this.cuponRepository.create({
      codigo: cupon.codigo,
      usuarioId: cupon.usuarioId,
      descuento: cupon.descuento,
      fechaExpiracion: cupon.fechaExpiracion,
      usado: cupon.usado,
    });
  }
}

module.exports = GenerarCuponPorInactividad;
