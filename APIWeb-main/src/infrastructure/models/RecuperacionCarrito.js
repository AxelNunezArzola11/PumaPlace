const { DataTypes } = require('sequelize');
const sequelize = require('../../config/database');

const RecuperacionCarrito = sequelize.define('RecuperacionCarrito', {
  id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
  // Stable recovery identifier: ONE claim row per order, globally. The route
  // inserts this row before merging the order lines into the buyer's active
  // cart; the UNIQUE index is the concurrency control — simultaneous
  // recoveries of the same order serialize here, exactly one wins, and every
  // loser (or later repeat) returns the current cart unchanged instead of
  // summing the lines again. Ownership is validated from the order itself
  // (orden.compradorId) BEFORE the insert, so per-order uniqueness is enough.
  ordenId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, unique: true },
  // Buyer who performed the recovery (always the order's compradorId).
  // Audit trail: who restored which abandoned checkout, and when.
  usuarioId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
}, { tableName: 'recuperaciones_carrito' });

module.exports = RecuperacionCarrito;
