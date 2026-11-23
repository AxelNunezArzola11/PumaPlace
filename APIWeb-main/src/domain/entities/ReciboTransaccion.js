/**
 * Entidad de dominio pura: ReciboTransaccion.
 * Comprobante interno entre comprador y vendedor (estudiantes).
 * NO es una factura fiscal: Puma Place no es parte de esta transacción.
 */
class ReciboTransaccion {
  constructor({ id = null, ordenId, folio = null, fecha = new Date() }) {
    if (!ordenId) {
      throw new Error('El recibo requiere un ordenId');
    }
    this.id = id;
    this.ordenId = ordenId;
    this.folio = folio || `RT-${ordenId}-${Date.now()}`;
    this.fecha = fecha;
  }
}

module.exports = ReciboTransaccion;