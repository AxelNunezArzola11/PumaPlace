const { DataTypes } = require('sequelize');
const sequelize = require('../../config/database');

const Orden = sequelize.define('Orden', {
  id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
  compradorId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  puntoEntrega: { type: DataTypes.STRING, allowNull: true },
  descuento: { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
  estado: { type: DataTypes.ENUM('pendiente', 'pagada'), allowNull: false, defaultValue: 'pendiente' },
  lineas: { type: DataTypes.JSON, allowNull: false, defaultValue: [] },
}, { tableName: 'ordenes' });

module.exports = Orden;
