const { DataTypes } = require('sequelize');
const sequelize = require('../../config/database');

const Usuario = sequelize.define('Usuario', {
  id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
  correo: { type: DataTypes.STRING(255), allowNull: false, unique: true },
  passwordHash: { type: DataTypes.STRING(255), allowNull: false },
  edad: { type: DataTypes.INTEGER, allowNull: false },
  rol: { type: DataTypes.ENUM('comprador', 'vendedor', 'dual'), allowNull: false, defaultValue: 'comprador' },
  plan: { type: DataTypes.ENUM('free', 'premium'), allowNull: false, defaultValue: 'free' },
  consentimientoDatos: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  nombreCompleto: { type: DataTypes.STRING(150), allowNull: true },
  telefono: { type: DataTypes.STRING(20), allowNull: true },
  numeroCuenta: { type: DataTypes.TEXT, allowNull: true },
  datosPagoCifrados: { type: DataTypes.TEXT, allowNull: true },
}, { tableName: 'usuarios' });

module.exports = Usuario;
