/**
 * Entidad de dominio pura: Cupon.
 */
class Cupon {
  constructor({ id = null, codigo, usuarioId, descuento, fechaExpiracion, usado = false }) {
    if (!usuarioId) {
      throw new Error('El cupón requiere un usuarioId');
    }
    if (!descuento || descuento <= 0) {
      throw new Error('El cupón requiere un descuento mayor a 0');
    }
    this.id = id;
    this.codigo = codigo;
    this.usuarioId = usuarioId;
    this.descuento = descuento;
    this.fechaExpiracion = fechaExpiracion;
    this.usado = usado;
  }

  /**
   * Regla core: generar un cupón de reactivación cuando un usuario
   * deja de usar la app (se decide en el caso de uso, esta es la fábrica).
   */
  static generarPorInactividad(usuarioId, descuento = 10) {
    const codigo = `VUELVE-${usuarioId}-${Date.now()}`;
    const fechaExpiracion = new Date();
    fechaExpiracion.setDate(fechaExpiracion.getDate() + 7);

    return new Cupon({ codigo, usuarioId, descuento, fechaExpiracion });
  }

  esValido(fechaActual = new Date()) {
    return !this.usado && fechaActual <= this.fechaExpiracion;
  }

  canjear() {
    if (!this.esValido()) {
      throw new Error('El cupón no es válido o ya expiró');
    }
    this.usado = true;
  }
}

module.exports = Cupon;