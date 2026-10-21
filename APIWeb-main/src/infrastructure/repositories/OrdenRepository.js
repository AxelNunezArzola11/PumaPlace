const Orden = require('../models/Orden');

const plain = (record) => (record && typeof record.toJSON === 'function' ? record.toJSON() : record);

class OrdenRepository {
  constructor({ model = Orden } = {}) {
    this.model = model;
  }

  async create(data) {
    return plain(await this.model.create(data));
  }

  async findById(id) {
    const record = await this.model.findByPk(id);
    return record ? plain(record) : null;
  }

  async save(id, data) {
    const record = await this.model.findByPk(id);
    if (!record) return null;
    await record.update(data);
    return plain(record);
  }
}

module.exports = OrdenRepository;
