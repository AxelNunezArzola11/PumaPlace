const Usuario = require('../models/Usuario');
const UsuarioEntity = require('../../domain/entities/Usuario');
const bcrypt = require('bcryptjs');

const plain = (record) => (record && typeof record.toJSON === 'function' ? record.toJSON() : record);

class UsuarioRepository {
  constructor({ model = Usuario } = {}) {
    this.model = model;
  }

  async findById(id) {
    const record = await this.model.findByPk(id);
    return record ? plain(record) : null;
  }

  async findByEmail(correo) {
    const record = await this.model.findOne({ where: { correo } });
    return record ? plain(record) : null;
  }

  async create(data) {
    const entity = new UsuarioEntity(data);
    if (!data.correo || typeof data.correo !== 'string') {
      throw new Error('El usuario requiere un correo');
    }
    if (!data.password || typeof data.password !== 'string' || data.password.length < 8) {
      throw new Error('La contraseña debe tener al menos 8 caracteres');
    }
    const record = await this.model.create({
      correo: data.correo.trim().toLowerCase(),
      passwordHash: await bcrypt.hash(data.password, 12),
      edad: entity.edad,
      rol: data.rol || 'comprador',
      plan: data.plan || 'free',
      consentimientoDatos: data.consentimientoDatos === true,
    });
    return plain(record);
  }

  async comparePassword(usuario, password) {
    return bcrypt.compare(password, usuario.passwordHash);
  }

  async updateById(id, changes) {
    const record = await this.model.findByPk(id);
    if (!record) return null;
    await record.update(changes);
    return plain(record);
  }
}

module.exports = UsuarioRepository;
