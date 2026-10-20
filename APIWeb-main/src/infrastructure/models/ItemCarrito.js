const { DataTypes } = require('sequelize');
const sequelize = require('../../config/database');

const ItemCarrito = sequelize.define('ItemCarrito', {
  id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
  carritoId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  productoId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  cantidad: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
}, { tableName: 'items_carrito' });

module.exports = ItemCarrito;
