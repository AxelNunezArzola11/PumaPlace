const { DataTypes } = require('sequelize');
const sequelize = require('../../config/database');

const LineaPedido = sequelize.define('LineaPedido', {
  id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
  ordenId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  productoId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  cantidad: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  precioUnitario: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
}, { tableName: 'lineas_pedido' });

module.exports = LineaPedido;
