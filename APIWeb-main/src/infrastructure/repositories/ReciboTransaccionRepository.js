const ReciboTransaccion = require('../models/ReciboTransaccion');

const plain = (record) => (record && typeof record.toJSON === 'function' ? record.toJSON() : record);

class ReciboTransaccionRepository {
  constructor({ model = ReciboTransaccion } = {}) {
    this.model = model;
  }

  async create(data) {
    return plain(await this.model.create(data));
  }
}

module.exports = ReciboTransaccionRepository;
