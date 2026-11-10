const { DataTypes } = require('sequelize');
const sequelize = require('../../config/database');

const Inventario = sequelize.define('Inventario', {
  id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
  productoId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, unique: true },
  cantidadDisponible: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  cantidadReservada: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
}, { tableName: 'inventarios' });

module.exports = Inventario;
