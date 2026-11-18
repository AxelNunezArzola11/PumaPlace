const Orden = require('../domain/entities/Orden');
const Pago = require('../domain/entities/Pago');
const ReciboTransaccion = require('../domain/entities/ReciboTransaccion');
const { EVENTS } = require('../domain/events/EventBus');

class ConfirmarPago {
  constructor({ ordenRepository, pagoRepository, reciboRepository, eventBus } = {}) {
    if (!ordenRepository || !pagoRepository || !reciboRepository || !eventBus) {
      throw new Error('ConfirmarPago requiere repositorios y EventBus');
    }
    this.ordenRepository = ordenRepository;
    this.pagoRepository = pagoRepository;
    this.reciboRepository = reciboRepository;
    this.eventBus = eventBus;
  }

  async execute(
    { ordenId, metodo = 'mercado_pago', planVendedor = 'free', gatewayConfirmed = false },
    { transaction = null } = {},
  ) {
    if (gatewayConfirmed !== true) {
      throw new Error('El pago requiere confirmación del gateway');
    }
    // The options argument is only appended when a transaction is actually
    // provided, so the no-transaction call signatures stay byte-identical.
    const extraArgs = transaction ? [{ transaction }] : [];
    const data = await this.ordenRepository.findById(ordenId, ...extraArgs);
    if (!data) throw new Error('Orden no encontrada');
    // Idempotency re-check INSIDE the transaction: a retried webhook that
    // arrives while another delivery is committing still sees one payment.
    // pagos.ordenId is UNIQUE as a backstop against exact races.
    if (data.estado === 'pagada') return { orden: data, pago: null, recibo: null };
    const orden = new Orden({
      id: data.id,
      compradorId: data.compradorId,
      puntoEntrega: data.puntoEntrega,
      descuento: Number(data.descuento || 0),
    });
    for (const linea of data.lineas || []) {
      orden.agregarLinea(linea.productoId, linea.cantidad, Number(linea.precioUnitario));
    }
    const { total } = orden.calcularTotal();
    orden.confirmarPago();
    const pago = new Pago({ ordenId, metodo, monto: total, planVendedor });
    const recibo = new ReciboTransaccion({ ordenId });
    const fechaLimiteProcesamiento = new Date(Date.now() + 3 * 60 * 60 * 1000);
    const savedOrder = await this.ordenRepository.save(ordenId, {
      estado: 'pagada',
      fechaLimiteProcesamiento,
    }, ...extraArgs);
    const savedPayment = await this.pagoRepository.create({
      ordenId: pago.ordenId,
      metodo: pago.metodo,
      monto: pago.monto,
      planVendedor,
      comision: pago.comision,
    }, ...extraArgs);
    const savedReceipt = await this.reciboRepository.create({
      ordenId: recibo.ordenId,
      folio: recibo.folio,
      fecha: recibo.fecha,
    }, ...extraArgs);
    this.eventBus.publish(EVENTS.ORDER_PAID, { orden: savedOrder, pago: savedPayment, recibo: savedReceipt });
    return { orden: savedOrder, pago: savedPayment, recibo: savedReceipt };
  }
}

module.exports = ConfirmarPago;
