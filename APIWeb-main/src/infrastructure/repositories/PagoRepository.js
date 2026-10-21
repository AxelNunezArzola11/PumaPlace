const Pago = require('../models/Pago');

const plain = (record) => (record && typeof record.toJSON === 'function' ? record.toJSON() : record);

class PagoRepository {
  constructor({ model = Pago } = {}) {
    this.model = model;
  }

  async create(data) {
    return plain(await this.model.create(data));
  }
}

module.exports = PagoRepository;
