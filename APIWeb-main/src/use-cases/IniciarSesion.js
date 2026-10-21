const jwt = require('jsonwebtoken');

class IniciarSesion {
  constructor({ usuarioRepository, jwtSecret = process.env.JWT_SECRET, expiresIn = process.env.JWT_EXPIRES_IN || '24h' } = {}) {
    if (!usuarioRepository) throw new Error('IniciarSesion requiere un repositorio');
    if (!jwtSecret) throw new Error('JWT_SECRET no está configurado');
    this.usuarioRepository = usuarioRepository;
    this.jwtSecret = jwtSecret;
    this.expiresIn = expiresIn;
  }

  async execute({ correo, password }) {
    if (!correo || !password) throw new Error('Correo y contraseña son obligatorios');
    const usuario = await this.usuarioRepository.findByEmail(correo.trim().toLowerCase());
    if (!usuario || !(await this.usuarioRepository.comparePassword(usuario, password))) {
      throw new Error('Credenciales inválidas');
    }
    const token = jwt.sign(
      { sub: usuario.id, rol: usuario.rol, plan: usuario.plan },
      this.jwtSecret,
      { expiresIn: this.expiresIn },
    );
    return {
      token,
      usuario: {
        id: usuario.id,
        correo: usuario.correo,
        edad: usuario.edad,
        rol: usuario.rol,
        plan: usuario.plan,
      },
    };
  }
}

module.exports = IniciarSesion;
