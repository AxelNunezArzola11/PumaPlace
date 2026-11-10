const Cupon = require('../models/Cupon');

const plain = (record) => (record && typeof record.toJSON === 'function' ? record.toJSON() : record);

class CuponRepository {
  constructor({ model = Cupon } = {}) {
    this.model = model;
  }

  async create(data) {
    return plain(await this.model.create(data));
  }
}

module.exports = CuponRepository;
