/**
 * Entidad de dominio pura: Carrito (y su ciclo de abandono).
 */
class Carrito {
  constructor({ id = null, usuarioId, items = [], estado = 'activo' }) {
    if (!usuarioId) {
      throw new Error('El carrito requiere un usuarioId');
    }
    this.id = id;
    this.usuarioId = usuarioId;
    this.items = items; // [{ productoId, cantidad }]
    this.estado = estado; // 'activo' | 'abandonado' | 'convertido'
  }

  agregarItem(productoId, cantidad = 1) {
    if (this.estado !== 'activo') throw new Error('Solo se puede editar un carrito activo');
    if (!productoId) throw new Error('El item requiere un productoId');
    if (!Number.isSafeInteger(cantidad) || cantidad <= 0) {
      throw new Error('La cantidad debe ser mayor a 0');
    }
    const existente = this.items.find((i) => i.productoId === productoId);
    if (existente) {
      existente.cantidad += cantidad;
    } else {
      this.items.push({ productoId, cantidad });
    }
  }

  /**
   * Regla core: si el usuario solo vio productos y no compró en X tiempo,
   * el carrito se marca abandonado (esto dispara, en infraestructura,
   * el correo de recordatorio y la liberación del inventario reservado).
   */
  abandonar() {
    if (this.items.length === 0) {
      throw new Error('No se puede abandonar un carrito vacío');
    }
    if (this.estado !== 'activo') {
      throw new Error('Solo un carrito activo puede marcarse como abandonado');
    }
    this.estado = 'abandonado';
  }

  marcarConvertido() {
    this.estado = 'convertido';
  }
}

module.exports = Carrito;