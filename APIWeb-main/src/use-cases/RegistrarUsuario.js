const Usuario = require('../domain/entities/Usuario');

class RegistrarUsuario {
  constructor({ usuarioRepository } = {}) {
    if (!usuarioRepository) throw new Error('RegistrarUsuario requiere un repositorio');
    this.usuarioRepository = usuarioRepository;
  }

  async execute(data) {
    if (data.consentimientoDatos !== true) {
      throw new Error('Se requiere consentimiento para el tratamiento de datos');
    }
    const usuarioEntity = new Usuario(data);
    const usuario = await this.usuarioRepository.create({
      ...data,
      edad: usuarioEntity.edad,
      consentimientoDatos: true,
    });
    return {
      id: usuario.id,
      correo: usuario.correo,
      edad: usuario.edad,
      rol: usuario.rol,
      plan: usuario.plan,
    };
  }
}

module.exports = RegistrarUsuario;
