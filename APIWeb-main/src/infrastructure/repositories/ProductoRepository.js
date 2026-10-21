const Producto = require('../models/Producto');

const plain = (record) => (record && typeof record.toJSON === 'function' ? record.toJSON() : record);

class ProductoRepository {
  constructor({ model = Producto } = {}) {
    this.model = model;
  }

  async countByVendedor(vendedorId) {
    return this.model.count({ where: { vendedorId } });
  }

  async create(data) {
    return plain(await this.model.create(data));
  }

  async findById(id) {
    const record = await this.model.findByPk(id);
    return record ? plain(record) : null;
  }
}

module.exports = ProductoRepository;
