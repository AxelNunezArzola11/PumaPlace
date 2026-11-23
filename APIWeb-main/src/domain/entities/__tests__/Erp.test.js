const Orden = require('../Orden');
const Pago = require('../Pago');

describe('Orden', () => {
  it('calcula el total como subtotal menos descuento, sin IVA ni envío', () => {
    const orden = new Orden({ compradorId: 1, puntoEntrega: 'Facultad de Ingeniería' });
    orden.agregarLinea(100, 2, 50); // 2 x $50 = $100
    orden.descuento = 20;

    const { subtotal, total } = orden.calcularTotal();
    expect(subtotal).toBe(100);
    expect(total).toBe(80);
  });

  it('no permite confirmar el pago de una orden sin líneas', () => {
    const orden = new Orden({ compradorId: 1 });
    expect(() => orden.confirmarPago()).toThrow(/sin líneas/i);
  });
});

describe('Pago', () => {
  it('cobra comisión del 10% a vendedor plan free usando Mercado Pago', () => {
    const pago = new Pago({ ordenId: 1, metodo: 'mercado_pago', monto: 300, planVendedor: 'free' });
    expect(pago.comision).toBe(30);
  });

  it('no cobra comisión a vendedor plan premium', () => {
    const pago = new Pago({ ordenId: 1, metodo: 'mercado_pago', monto: 300, planVendedor: 'premium' });
    expect(pago.comision).toBe(0);
  });

  it('no cobra comisión si el pago es en efectivo', () => {
    const pago = new Pago({ ordenId: 1, metodo: 'efectivo', monto: 300, planVendedor: 'free' });
    expect(pago.comision).toBe(0);
  });
});

const ReciboTransaccion = require('../ReciboTransaccion');
describe('Regresiones ERP', () => {
  it('confirma una orden y evita modificarla o pagar dos veces', () => {
    const o = new Orden({ compradorId: 1 }); o.agregarLinea(1, 2, 0.1);
    expect(o.calcularTotal()).toEqual({ subtotal: 0.2, total: 0.2 });
    o.confirmarPago(); expect(o.estado).toBe('pagada');
    expect(() => o.confirmarPago()).toThrow(/pagada/);
    expect(() => o.agregarLinea(2, 1, 10)).toThrow(/pagada/);
  });
  it('rechaza descuentos que superan el subtotal', () => {
    const o = new Orden({ compradorId: 1, descuento: 11 }); o.agregarLinea(1, 1, 10);
    expect(() => o.calcularTotal()).toThrow(/descuento/);
  });
  it.each([0, -1, NaN, Infinity, 1.5, '2'])('rechaza cantidad de orden %s', cantidad => {
    expect(() => new Orden({ compradorId: 1 }).agregarLinea(1, cantidad, 10)).toThrow();
  });
  it('calcula monto neto y conserva el folio de un recibo existente', () => {
    const p = new Pago({ ordenId: 1, metodo: 'mercado_pago', monto: 300 });
    expect(p.procesar()).toEqual({ ordenId: 1, montoNeto: 270 });
    expect(new ReciboTransaccion({ ordenId: 1, folio: 'RT-1' }).folio).toBe('RT-1');
    expect(() => new ReciboTransaccion({})).toThrow(/ordenId/);
  });
  it.each([0, -1, NaN, Infinity, '300'])('rechaza monto %s', monto => {
    expect(() => new Pago({ ordenId: 1, metodo: 'efectivo', monto })).toThrow();
  });
});
