const { DataTypes } = require('sequelize');
const sequelize = require('../../config/database');

const ReciboTransaccion = sequelize.define('ReciboTransaccion', {
  id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
  ordenId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  folio: { type: DataTypes.STRING, allowNull: false, unique: true },
  fecha: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
}, { tableName: 'recibos_transaccion' });

module.exports = ReciboTransaccion;
