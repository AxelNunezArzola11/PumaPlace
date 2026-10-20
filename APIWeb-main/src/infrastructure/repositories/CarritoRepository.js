const Carrito = require('../models/Carrito');

const plain = (record) => (record && typeof record.toJSON === 'function' ? record.toJSON() : record);

class CarritoRepository {
  constructor({ model = Carrito } = {}) {
    this.model = model;
  }

  async findActiveByUsuarioId(usuarioId) {
    const record = await this.model.findOne({ where: { usuarioId, estado: 'activo' } });
    return record ? plain(record) : null;
  }

  async findById(id) {
    const record = await this.model.findByPk(id);
    return record ? plain(record) : null;
  }

  async save(data) {
    if (data.id) {
      const record = await this.model.findByPk(data.id);
      if (!record) return null;
      await record.update(data);
      return plain(record);
    }
    return plain(await this.model.create(data));
  }
}

module.exports = CarritoRepository;
