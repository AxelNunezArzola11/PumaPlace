const { DataTypes } = require('sequelize');
const sequelize = require('../../config/database');

const Pago = sequelize.define('Pago', {
  id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
  ordenId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  metodo: { type: DataTypes.ENUM('efectivo', 'transferencia', 'mercado_pago'), allowNull: false },
  monto: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
  planVendedor: { type: DataTypes.ENUM('free', 'premium'), allowNull: false, defaultValue: 'free' },
  comision: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
}, { tableName: 'pagos' });

module.exports = Pago;
