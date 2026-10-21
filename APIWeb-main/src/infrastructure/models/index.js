const Usuario = require('./Usuario');
const Carrito = require('./Carrito');
const Orden = require('./Orden');
const Pago = require('./Pago');
const Inventario = require('./Inventario');
const Cupon = require('./Cupon');
const Notificacion = require('./Notificacion');
const ReciboTransaccion = require('./ReciboTransaccion');
const SeguimientoStock = require('./SeguimientoStock');
const Categoria = require('./Categoria');
const Producto = require('./Producto');
const ItemCarrito = require('./ItemCarrito');
const LineaPedido = require('./LineaPedido');
const Suscripcion = require('./Suscripcion');

Usuario.hasMany(Carrito, { foreignKey: 'usuarioId', as: 'carritos' });
Carrito.belongsTo(Usuario, { foreignKey: 'usuarioId', as: 'usuario' });
Usuario.hasMany(Producto, { foreignKey: 'vendedorId', as: 'productos' });
Producto.belongsTo(Usuario, { foreignKey: 'vendedorId', as: 'vendedor' });
Usuario.hasMany(Suscripcion, { foreignKey: 'usuarioId', as: 'suscripciones' });
Suscripcion.belongsTo(Usuario, { foreignKey: 'usuarioId', as: 'usuario' });
Categoria.hasMany(Producto, { foreignKey: 'categoriaId', as: 'productos' });
Producto.belongsTo(Categoria, { foreignKey: 'categoriaId', as: 'categoria' });
Producto.hasOne(Inventario, { foreignKey: 'productoId', as: 'inventario' });
Inventario.belongsTo(Producto, { foreignKey: 'productoId', as: 'producto' });
Carrito.hasMany(ItemCarrito, { foreignKey: 'carritoId', as: 'itemsCarrito' });
ItemCarrito.belongsTo(Carrito, { foreignKey: 'carritoId', as: 'carrito' });
Producto.hasMany(ItemCarrito, { foreignKey: 'productoId', as: 'itemsCarrito' });
ItemCarrito.belongsTo(Producto, { foreignKey: 'productoId', as: 'producto' });
Usuario.hasMany(Orden, { foreignKey: 'compradorId', as: 'ordenes' });
Orden.belongsTo(Usuario, { foreignKey: 'compradorId', as: 'comprador' });
Orden.hasMany(LineaPedido, { foreignKey: 'ordenId', as: 'lineasPedido' });
LineaPedido.belongsTo(Orden, { foreignKey: 'ordenId', as: 'orden' });
Producto.hasMany(LineaPedido, { foreignKey: 'productoId', as: 'lineasPedido' });
LineaPedido.belongsTo(Producto, { foreignKey: 'productoId', as: 'producto' });
Orden.hasMany(Pago, { foreignKey: 'ordenId', as: 'pagos' });
Pago.belongsTo(Orden, { foreignKey: 'ordenId', as: 'orden' });
Orden.hasOne(ReciboTransaccion, { foreignKey: 'ordenId', as: 'recibo' });
ReciboTransaccion.belongsTo(Orden, { foreignKey: 'ordenId', as: 'orden' });
Usuario.hasMany(Cupon, { foreignKey: 'usuarioId', as: 'cupones' });
Cupon.belongsTo(Usuario, { foreignKey: 'usuarioId', as: 'usuario' });
Usuario.hasMany(Notificacion, { foreignKey: 'usuarioId', as: 'notificaciones' });
Notificacion.belongsTo(Usuario, { foreignKey: 'usuarioId', as: 'usuario' });
Usuario.hasMany(SeguimientoStock, { foreignKey: 'usuarioId', as: 'seguimientosStock' });
SeguimientoStock.belongsTo(Usuario, { foreignKey: 'usuarioId', as: 'usuario' });
Producto.hasMany(SeguimientoStock, { foreignKey: 'productoId', as: 'seguimientosStock' });
SeguimientoStock.belongsTo(Producto, { foreignKey: 'productoId', as: 'producto' });

module.exports = {
  Usuario,
  Categoria,
  Producto,
  Carrito,
  ItemCarrito,
  Orden,
  LineaPedido,
  Pago,
  Inventario,
  Cupon,
  Notificacion,
  ReciboTransaccion,
  SeguimientoStock,
  Suscripcion,
};
