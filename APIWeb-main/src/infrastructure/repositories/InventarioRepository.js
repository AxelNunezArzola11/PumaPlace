const Inventario = require('../models/Inventario');

const plain = (record) => (record && typeof record.toJSON === 'function' ? record.toJSON() : record);

class InventarioRepository {
  constructor({ model = Inventario } = {}) {
    this.model = model;
  }

  async findByProductoId(productoId) {
    const record = await this.model.findOne({ where: { productoId } });
    return record ? plain(record) : null;
  }

  async save(data) {
    const record = await this.model.findOne({ where: { productoId: data.productoId } });
    if (!record) return plain(await this.model.create(data));
    await record.update(data);
    return plain(record);
  }
}

module.exports = InventarioRepository;
