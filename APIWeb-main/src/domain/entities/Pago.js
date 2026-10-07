/**
 * Entidad de dominio pura: Pago.
 * La comisión solo aplica si el vendedor es plan 'free' y usa pasarela;
 * si es 'premium', la comisión es 0 (paga Suscripcion en su lugar).
 */
const COMISION_PLAN_FREE = 0.1; // 10%

class Pago {
  constructor({ id = null, ordenId, metodo, monto, planVendedor = 'free', comision = null }) {
    if (!ordenId) {
      throw new Error('El pago requiere un ordenId');
    }
    if (!Number.isFinite(monto) || monto <= 0) {
      throw new Error('El monto del pago debe ser mayor a 0');
    }

    if (!['efectivo', 'transferencia', 'mercado_pago'].includes(metodo))
      throw new Error('Método de pago inválido');
    if (!['free', 'premium'].includes(planVendedor))
      throw new Error('Plan de vendedor inválido');
    if (comision !== null && (!Number.isFinite(comision) || comision < 0 || comision > monto))
      throw new Error('Comisión inválida');
    this.id = id;
    this.ordenId = ordenId;
    this.metodo = metodo; // 'efectivo' | 'transferencia' | 'mercado_pago'
    this.monto = monto;
    this.comision =
      comision !== null ? comision : Pago.calcularComision(monto, metodo, planVendedor);
  }

  static calcularComision(monto, metodo, planVendedor) {
    const usaPasarela = metodo === 'mercado_pago';
    if (!usaPasarela) return 0; // efectivo/transferencia: sin comisión
    if (planVendedor === 'premium') return 0; // premium: sin comisión
    return +(monto * COMISION_PLAN_FREE).toFixed(2);
  }

  procesar() {
    if (this.monto <= 0) {
      throw new Error('No se puede procesar un pago con monto 0');
    }
    return { ordenId: this.ordenId, montoNeto: +(this.monto - this.comision).toFixed(2) };
  }
}

module.exports = Pago;