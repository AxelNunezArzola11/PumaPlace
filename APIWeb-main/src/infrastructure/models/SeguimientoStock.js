const { DataTypes } = require('sequelize');
const sequelize = require('../../config/database');

const SeguimientoStock = sequelize.define('SeguimientoStock', {
  id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
  usuarioId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  productoId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  activo: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
}, { tableName: 'seguimientos_stock' });

module.exports = SeguimientoStock;
