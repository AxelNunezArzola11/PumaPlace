const { Op } = require('sequelize');
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

  /**
   * Conditional cancel: transitions to `cancelada` ONLY when the order is
   * still open (pendiente/procesando), in ONE atomic UPDATE. Returns true
   * when this caller won the transition, false when someone else (payment
   * approval, another cancel, the expiry sweeper) already moved the order.
   * The winner alone may release the reservation — concurrent losers must
   * skip, so the same stock can never be released twice. TiDB/MySQL-safe.
   */
  async cancelIfOpen(id, options = {}) {
    const queryOptions = {};
    if (options.transaction) queryOptions.transaction = options.transaction;
    const [affected] = await this.model.update(
      { estado: 'cancelada' },
      {
        where: { id, estado: { [Op.in]: ['pendiente', 'procesando'] } },
        ...queryOptions,
      },
    );
    return Number(affected) > 0;
  }

  /**
   * Expiry candidates: open orders created before `cutoff`, oldest first,
   * bounded by `limit` so a sweep never scans or locks the whole table.
   */
  async findExpirableCandidates(cutoff, limit = 100) {
    const records = await this.model.findAll({
      where: {
        estado: { [Op.in]: ['pendiente', 'procesando'] },
        createdAt: { [Op.lt]: cutoff },
      },
      order: [['createdAt', 'ASC']],
      limit,
    });
    return records.map(plain);
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
