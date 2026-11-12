const { evaluarPago } = require('../api');

const orden = {
  descuento: 0,
  lineas: [{ precioUnitario: 25, cantidad: 2 }],
};

describe('reglas del webhook de pagos', () => {
  it.each([
    ['rejected', 'cancel'],
    ['cancelled', 'cancel'],
    ['pending', 'pending'],
    ['in_process', 'pending'],
  ])('no vende una orden con estado %s', (status, expected) => {
    expect(evaluarPago({ payment: { status, transaction_amount: 50 }, orden })).toBe(expected);
  });

  it('confirma sólo un pago aprobado con el monto exacto', () => {
    expect(evaluarPago({
      payment: { status: 'approved', transaction_amount: 50 },
      orden,
    })).toBe('approved');
  });

  it('rechaza un monto aprobado que no coincide con la orden', () => {
    expect(() => evaluarPago({
      payment: { status: 'approved', transaction_amount: 49 },
      orden,
    })).toThrow(/monto/i);
  });
});
