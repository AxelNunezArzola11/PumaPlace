const { Op } = require('sequelize');
const Inventario = require('../models/Inventario');

const plain = (record) => (record && typeof record.toJSON === 'function' ? record.toJSON() : record);

function assertCantidad(cantidad, verbo) {
  if (!Number.isSafeInteger(cantidad) || cantidad <= 0) {
    throw new Error(`La cantidad a ${verbo} debe ser un entero mayor a 0`);
  }
}

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

  sequelizeInstance() {
    const sequelize = this.model.sequelize;
    if (!sequelize) {
      throw new Error('InventarioRepository requiere un modelo con instancia de Sequelize');
    }
    return sequelize;
  }

  txOptions(options = {}) {
    return options.transaction ? { transaction: options.transaction } : {};
  }

  /**
   * Atomic reservation: moves `cantidad` from disponible to reservada in ONE
   * conditional UPDATE (InnoDB/TiDB row lock). Returns true when reserved,
   * false when stock is insufficient. Concurrent checkouts cannot oversell:
   * only statements whose WHERE still holds at lock time affect a row.
   * TiDB/MySQL-compatible; no SELECT FOR UPDATE needed.
   */
  async tryReserve(productoId, cantidad, options = {}) {
    assertCantidad(cantidad, 'reservar');
    const sequelize = this.sequelizeInstance();
    const [affected] = await this.model.update(
      {
        cantidadDisponible: sequelize.literal(`cantidadDisponible - ${cantidad}`),
        cantidadReservada: sequelize.literal(`cantidadReservada + ${cantidad}`),
      },
      {
        where: { productoId, cantidadDisponible: { [Op.gte]: cantidad } },
        ...this.txOptions(options),
      },
    );
    return Number(affected) > 0;
  }

  /**
   * Atomic release: returns `cantidad` from reservada to disponible.
   * Returns true when released, false when the reservation does not cover
   * `cantidad` (already released or never reserved — the caller decides
   * whether that is an error; cancellation treats it as a no-op).
   */
  async releaseReservation(productoId, cantidad, options = {}) {
    assertCantidad(cantidad, 'liberar');
    const sequelize = this.sequelizeInstance();
    const [affected] = await this.model.update(
      {
        cantidadDisponible: sequelize.literal(`cantidadDisponible + ${cantidad}`),
        cantidadReservada: sequelize.literal(`cantidadReservada - ${cantidad}`),
      },
      {
        where: { productoId, cantidadReservada: { [Op.gte]: cantidad } },
        ...this.txOptions(options),
      },
    );
    return Number(affected) > 0;
  }

  /**
   * Atomic commit: consumes `cantidad` from the reservation and, when the
   * reservation does not cover it, the remainder from disponible.
   * Returns false when total stock cannot cover `cantidad`, so the caller
   * can roll back instead of overselling. Runs inside the webhook
   * transaction in production.
   */
  async commitReservation(productoId, cantidad, options = {}) {
    assertCantidad(cantidad, 'confirmar');
    const sequelize = this.sequelizeInstance();
    const [affected] = await this.model.update(
      {
        cantidadReservada: sequelize.literal(`cantidadReservada - LEAST(cantidadReservada, ${cantidad})`),
        cantidadDisponible: sequelize.literal(
          `cantidadDisponible - GREATEST(0, ${cantidad} - LEAST(cantidadReservada, ${cantidad}))`,
        ),
      },
      {
        where: {
          productoId,
          [Op.and]: [
            sequelize.where(
              sequelize.literal('(cantidadReservada + cantidadDisponible)'),
              Op.gte,
              cantidad,
            ),
          ],
        },
        ...this.txOptions(options),
      },
    );
    return Number(affected) > 0;
  }
}

module.exports = InventarioRepository;
