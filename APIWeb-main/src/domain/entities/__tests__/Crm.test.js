const Carrito = require('../Carrito');
const Cupon = require('../Cupon');
const SeguimientoStock = require('../SeguimientoStock');

describe('Carrito', () => {
  it('se marca abandonado si tiene items y está activo', () => {
    const carrito = new Carrito({ usuarioId: 1 });
    carrito.agregarItem(10, 2);
    carrito.abandonar();
    expect(carrito.estado).toBe('abandonado');
  });

  it('no permite abandonar un carrito vacío', () => {
    const carrito = new Carrito({ usuarioId: 1 });
    expect(() => carrito.abandonar()).toThrow(/vacío/i);
  });
});

describe('Cupon', () => {
  it('genera un cupón válido por inactividad', () => {
    const cupon = Cupon.generarPorInactividad(1);
    expect(cupon.esValido()).toBe(true);
    expect(cupon.usuarioId).toBe(1);
  });

  it('no se puede canjear dos veces', () => {
    const cupon = Cupon.generarPorInactividad(1);
    cupon.canjear();
    expect(() => cupon.canjear()).toThrow(/no es válido/i);
  });
});

describe('SeguimientoStock', () => {
  it('notifica solo si el producto volvió a tener stock', () => {
    const seguimiento = new SeguimientoStock({ usuarioId: 1, productoId: 10 });
    expect(seguimiento.notificarSiDisponible(false)).toBe(false);
    expect(seguimiento.notificarSiDisponible(true)).toBe(true);
    expect(seguimiento.activo).toBe(false);
  });
});

const Notificacion = require('../Notificacion');
describe('Regresiones CRM', () => {
  it('acumula unidades de un mismo producto', () => {
    const c = new Carrito({ usuarioId: 1 });
    c.agregarItem(10, 2); c.agregarItem(10, 1);
    expect(c.items).toEqual([{ productoId: 10, cantidad: 3 }]);
    c.abandonar();
    expect(() => c.agregarItem(10)).toThrow(/activo/);
  });
  it('rechaza un cupón vencido', () => {
    const c = new Cupon({ usuarioId: 1, codigo: 'V', descuento: 10, fechaExpiracion: new Date('2000-01-01') });
    expect(c.esValido(new Date('2000-01-02'))).toBe(false);
    expect(() => c.canjear()).toThrow(/expiró/);
  });
  it('notifica reabastecimiento una sola vez', () => {
    const s = new SeguimientoStock({ usuarioId: 1, productoId: 10 });
    expect(s.notificarSiDisponible(true)).toBe(true);
    expect(s.notificarSiDisponible(true)).toBe(false);
  });
  it('valida el tipo de notificación y registra el envío', () => {
    expect(() => new Notificacion({ usuarioId: 1, tipo: 'inexistente' })).toThrow(/inválido/);
    const n = new Notificacion({ usuarioId: 1, tipo: 'reabastecimiento', mensaje: 'Disponible' });
    expect(n.enviada).toBe(false);
    n.marcarEnviada(); expect(n.enviada).toBe(true);
  });
});
