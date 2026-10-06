/**
 * Entidad de dominio pura: Inventario.
 * No depende de Sequelize ni de Express.
 */
class Inventario {
  constructor({ id = null, productoId, cantidadDisponible = 0, cantidadReservada = 0 }) {
    if (!productoId) {
      throw new Error('El inventario requiere un productoId');
    }
    if (![cantidadDisponible, cantidadReservada].every(n => Number.isSafeInteger(n) && n >= 0)) {
      throw new Error('Las existencias deben ser enteros no negativos');
    }
    this.id = id;
    this.productoId = productoId;
    this.cantidadDisponible = cantidadDisponible;
    this.cantidadReservada = cantidadReservada;
  }

  /** Se usa cuando un comprador aparta el producto (orden pendiente de pago). */
  reservarStock(cantidad) {
    if (!Number.isSafeInteger(cantidad) || cantidad <= 0) {
      throw new Error('La cantidad a reservar debe ser mayor a 0');
    }
    if (cantidad > this.cantidadDisponible) {
      throw new Error('No hay suficiente stock disponible para reservar');
    }
    this.cantidadDisponible -= cantidad;
    this.cantidadReservada += cantidad;
  }

  /** Se usa cuando el cliente solo vio el producto y no compró, o canceló la orden. */
  liberarStock(cantidad) {
    if (!Number.isSafeInteger(cantidad) || cantidad <= 0) {
      throw new Error('La cantidad a liberar debe ser mayor a 0');
    }
    if (cantidad > this.cantidadReservada) {
      throw new Error('No se puede liberar más de lo reservado');
    }
    this.cantidadReservada -= cantidad;
    this.cantidadDisponible += cantidad;
  }

  /** Se usa cuando llega mercancía nueva. Si estaba en 0, vuelve a haber stock. */
  reponerStock(cantidad) {
    if (!Number.isSafeInteger(cantidad) || cantidad <= 0) {
      throw new Error('La cantidad a reponer debe ser mayor a 0');
    }
    const volvioAHaberStock = this.cantidadDisponible === 0;
    this.cantidadDisponible += cantidad;
    return { volvioAHaberStock };
  }
}

module.exports = Inventario;