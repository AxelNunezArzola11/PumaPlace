const Orden = require('../models/Orden');

const plain = (record) => (record && typeof record.toJSON === 'function' ? record.toJSON() : record);

class OrdenRepository {
  constructor({ model = Orden } = {}) {
    this.model = model;
  }

  async findAll(options = {}) {
    const records = await this.model.findAll(options);
    return records.map(plain);
  }

  async create(data, options = {}) {
    return plain(await this.model.create(data, options));
  }

  async findById(id, options = {}) {
    const record = await this.model.findByPk(id, options);
    return record ? plain(record) : null;
  }

  async save(id, data, options = {}) {
    const record = await this.model.findByPk(id, options);
    if (!record) return null;
    await record.update(data, options);
    return plain(record);
  }

  async updateById(id, data, options = {}) {
    return this.save(id, data, options);
  }

  async deleteById(id) {
    const record = await this.model.findByPk(id);
    if (!record) return false;
    await record.destroy();
    return true;
  }
}

module.exports = OrdenRepository;
