const { DataTypes } = require('sequelize');
const sequelize = require('../../config/database');

const Suscripcion = sequelize.define('Suscripcion', {
  id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
  usuarioId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  plan: { type: DataTypes.ENUM('premium'), allowNull: false, defaultValue: 'premium' },
  estado: { type: DataTypes.ENUM('activa', 'cancelada', 'expirada'), allowNull: false, defaultValue: 'activa' },
  fechaInicio: { type: DataTypes.DATE, allowNull: false },
  fechaFin: { type: DataTypes.DATE, allowNull: false },
}, { tableName: 'suscripciones' });

module.exports = Suscripcion;
