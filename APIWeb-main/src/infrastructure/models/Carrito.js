const { DataTypes } = require('sequelize');
const sequelize = require('../../config/database');

const Carrito = sequelize.define('Carrito', {
  id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
  usuarioId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  items: { type: DataTypes.JSON, allowNull: false, defaultValue: [] },
  estado: { type: DataTypes.ENUM('activo', 'abandonado', 'convertido'), allowNull: false, defaultValue: 'activo' },
}, { tableName: 'carritos' });

module.exports = Carrito;
