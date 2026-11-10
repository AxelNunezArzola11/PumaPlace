class ConvertirEnVendedor {
  constructor({ usuarioRepository } = {}) {
    if (!usuarioRepository) throw new Error('ConvertirEnVendedor requiere un repositorio');
    this.usuarioRepository = usuarioRepository;
  }

  async execute(usuarioId) {
    const usuario = await this.usuarioRepository.findById(usuarioId);
    if (!usuario) throw new Error('Usuario no encontrado');
    return this.usuarioRepository.updateById(usuarioId, { rol: 'vendedor' });
  }
}

module.exports = ConvertirEnVendedor;
