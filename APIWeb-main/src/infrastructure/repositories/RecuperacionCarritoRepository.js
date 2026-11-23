const RecuperacionCarrito = require('../models/RecuperacionCarrito');

const plain = (record) => (record && typeof record.toJSON === 'function' ? record.toJSON() : record);

class RecuperacionCarritoRepository {
  constructor({ model = RecuperacionCarrito } = {}) {
    this.model = model;
  }

  async create(data, options = {}) {
    return plain(await this.model.create(data, options));
  }
}

module.exports = RecuperacionCarritoRepository;
