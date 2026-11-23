const plain = (record) => (record && typeof record.toJSON === 'function' ? record.toJSON() : record);

class CrudRepository {
  constructor(model) {
    if (!model) throw new Error('CrudRepository requiere un modelo');
    this.model = model;
  }

  async findAll(options = {}) {
    const records = await this.model.findAll(options);
    return records.map(plain);
  }

  async findById(id) {
    const record = await this.model.findByPk(id);
    return record ? plain(record) : null;
  }

  async create(data) {
    return plain(await this.model.create(data));
  }

  async updateById(id, data) {
    const record = await this.model.findByPk(id);
    if (!record) return null;
    await record.update(data);
    return plain(record);
  }

  async deleteById(id) {
    const record = await this.model.findByPk(id);
    if (!record) return false;
    await record.destroy();
    return true;
  }
}

module.exports = CrudRepository;
