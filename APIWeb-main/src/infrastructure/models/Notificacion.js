const { DataTypes } = require('sequelize');
const sequelize = require('../../config/database');
const NotificacionEntity = require('../../domain/entities/Notificacion');

const Notificacion = sequelize.define('Notificacion', {
  id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
  usuarioId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  tipo: { type: DataTypes.ENUM(...NotificacionEntity.TIPOS_VALIDOS), allowNull: false },
  mensaje: { type: DataTypes.TEXT, allowNull: false },
  fecha: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  enviada: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
}, { tableName: 'notificaciones' });

module.exports = Notificacion;
