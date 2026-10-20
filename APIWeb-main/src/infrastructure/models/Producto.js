const { DataTypes } = require('sequelize');
const sequelize = require('../../config/database');

const Producto = sequelize.define('Producto', {
  id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
  vendedorId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  categoriaId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  nombre: { type: DataTypes.STRING(150), allowNull: false },
  descripcion: { type: DataTypes.TEXT, allowNull: false },
  precio: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
  estado: { type: DataTypes.ENUM('publicado', 'pausado', 'vendido'), allowNull: false, defaultValue: 'publicado' },
}, { tableName: 'productos' });

module.exports = Producto;
