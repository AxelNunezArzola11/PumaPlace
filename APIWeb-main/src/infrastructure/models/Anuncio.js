const { DataTypes } = require('sequelize');
const sequelize = require('../../config/database');

// Advertisement placements shown in the storefront. `catalogo` renders above
// the product grid in ListaProductos; other values are reserved for future
// storefront slots and are all served by GET /api/anuncios/activos.
const PLACEMENTS = Object.freeze(['catalogo', 'banner', 'lateral']);

const Anuncio = sequelize.define('Anuncio', {
  id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
  title: { type: DataTypes.STRING(150), allowNull: false },
  description: { type: DataTypes.TEXT, allowNull: true },
  imageUrl: { type: DataTypes.STRING(2048), allowNull: false },
  targetUrl: { type: DataTypes.STRING(2048), allowNull: false },
  // Display name shown next to the ad ("Anunciante: X"). Internal contact or
  // billing details must never be stored here: this column is public.
  advertiser: { type: DataTypes.STRING(150), allowNull: false },
  placement: { type: DataTypes.ENUM(...PLACEMENTS), allowNull: false, defaultValue: 'catalogo' },
  active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  startAt: { type: DataTypes.DATE, allowNull: true },
  endAt: { type: DataTypes.DATE, allowNull: true },
}, { tableName: 'anuncios' });

module.exports = Anuncio;
module.exports.PLACEMENTS = PLACEMENTS;
