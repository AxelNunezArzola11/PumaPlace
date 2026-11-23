const Suscripcion = require('../models/Suscripcion');

const plain = (record) => (record && typeof record.toJSON === 'function' ? record.toJSON() : record);

class SuscripcionRepository {
  constructor({ model = Suscripcion } = {}) {
    this.model = model;
  }

  async create(data) {
    return plain(await this.model.create(data));
  }

  async findActiveByUsuarioId(usuarioId) {
    const record = await this.model.findOne({ where: { usuarioId, estado: 'activa' } });
    return record ? plain(record) : null;
  }
}

module.exports = SuscripcionRepository;
