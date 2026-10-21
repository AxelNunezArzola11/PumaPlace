const { DataTypes } = require('sequelize');
const sequelize = require('../../config/database');

const Cupon = sequelize.define('Cupon', {
  id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
  codigo: { type: DataTypes.STRING, allowNull: false, unique: true },
  usuarioId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  descuento: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
  fechaExpiracion: { type: DataTypes.DATE, allowNull: false },
  usado: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
}, { tableName: 'cupones' });

module.exports = Cupon;
