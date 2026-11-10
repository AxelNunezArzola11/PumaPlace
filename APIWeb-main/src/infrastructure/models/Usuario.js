const { DataTypes } = require('sequelize');
const sequelize = require('../../config/database');

const Usuario = sequelize.define('Usuario', {
  id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
  correo: { type: DataTypes.STRING(255), allowNull: false, unique: true },
  passwordHash: { type: DataTypes.STRING(255), allowNull: false },
  edad: { type: DataTypes.INTEGER, allowNull: false },
  rol: { type: DataTypes.ENUM('comprador', 'vendedor'), allowNull: false, defaultValue: 'comprador' },
  plan: { type: DataTypes.ENUM('free', 'premium'), allowNull: false, defaultValue: 'free' },
  consentimientoDatos: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
}, { tableName: 'usuarios' });

module.exports = Usuario;
