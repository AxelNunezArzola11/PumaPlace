const Carrito = require('../models/Carrito');

const plain = (record) => (record && typeof record.toJSON === 'function' ? record.toJSON() : record);

class CarritoRepository {
  constructor({ model = Carrito } = {}) {
    this.model = model;
  }

  async findActiveByUsuarioId(usuarioId, options = {}) {
    const record = await this.model.findOne({ where: { usuarioId, estado: 'activo' }, ...options });
    return record ? plain(record) : null;
  }

  async findById(id) {
    const record = await this.model.findByPk(id);
    return record ? plain(record) : null;
  }

  async save(data, options = {}) {
    if (data.id) {
      const record = await this.model.findByPk(data.id, options);
      if (!record) return null;
      await record.update(data, options);
      return plain(record);
    }
    return plain(await this.model.create(data, options));
  }
}

module.exports = CarritoRepository;
