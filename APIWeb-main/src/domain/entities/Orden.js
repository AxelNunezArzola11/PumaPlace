/** Orden de dominio; no realiza cobros ni persiste información. */
class Orden {
  constructor({ id = null, compradorId, puntoEntrega = null, descuento = 0 }) {
    if (!compradorId) throw new Error('La orden requiere un compradorId');
    Object.assign(this, { id, compradorId, puntoEntrega, descuento });
    this.lineas = [];
    this.estado = 'pendiente';
  }
  agregarLinea(productoId, cantidad, precioUnitario) {
    if (this.estado !== 'pendiente') throw new Error('La orden ya está pagada');
    if (!productoId) throw new Error('La línea requiere un productoId');
    if (!Number.isSafeInteger(cantidad) || cantidad <= 0)
      throw new Error('La cantidad debe ser un entero mayor a 0');
    if (!Number.isFinite(precioUnitario) || precioUnitario < 0)
      throw new Error('El precio debe ser un número no negativo');
    this.lineas.push({ productoId, cantidad, precioUnitario });
  }
  calcularTotal() {
    if (!Number.isFinite(this.descuento) || this.descuento < 0)
      throw new Error('El descuento debe ser un número no negativo');
    const centavos = this.lineas.reduce((s, l) =>
      s + Math.round(l.precioUnitario * 100) * l.cantidad, 0);
    const descuento = Math.round(this.descuento * 100);
    if (descuento > centavos) throw new Error('El descuento supera el subtotal');
    return { subtotal: centavos / 100, total: (centavos - descuento) / 100 };
  }
  confirmarPago() {
    if (!this.lineas.length) throw new Error('No se puede pagar una orden sin líneas');
    if (this.estado !== 'pendiente') throw new Error('La orden ya está pagada');
    this.calcularTotal();
    this.estado = 'pagada';
  }
}
module.exports = Orden;
