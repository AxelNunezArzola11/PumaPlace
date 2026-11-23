/**
 * Entidad de dominio pura: SeguimientoStock.
 * Representa que un usuario quiere que le avisen cuando un producto
 * vuelva a tener inventario disponible.
 */
class SeguimientoStock {
  constructor({ id = null, usuarioId, productoId, activo = true }) {
    if (!usuarioId || !productoId) {
      throw new Error('El seguimiento de stock requiere usuarioId y productoId');
    }
    this.id = id;
    this.usuarioId = usuarioId;
    this.productoId = productoId;
    this.activo = activo;
  }

  /**
   * Regla core: si el inventario reportó que volvió a haber stock,
   * este seguimiento decide si debe notificarse.
   */
  notificarSiDisponible(volvioAHaberStock) {
    if (!this.activo) return false;
    if (!volvioAHaberStock) return false;

    this.activo = false; // ya se avisó, se desactiva para no notificar de más
    return true;
  }
}

module.exports = SeguimientoStock;