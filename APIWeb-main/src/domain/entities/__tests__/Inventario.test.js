const Inventario = require('../Inventario');

describe('Inventario', () => {
  it('reserva stock cuando hay disponibilidad', () => {
    const inv = new Inventario({ productoId: 1, cantidadDisponible: 5 });
    inv.reservarStock(2);
    expect(inv.cantidadDisponible).toBe(3);
    expect(inv.cantidadReservada).toBe(2);
  });

  it('no permite reservar más de lo disponible', () => {
    const inv = new Inventario({ productoId: 1, cantidadDisponible: 1 });
    expect(() => inv.reservarStock(5)).toThrow(/suficiente stock/i);
  });

  it('libera stock reservado cuando el cliente no compra (vuelve a disponible)', () => {
    const inv = new Inventario({ productoId: 1, cantidadDisponible: 3, cantidadReservada: 2 });
    inv.liberarStock(2);
    expect(inv.cantidadDisponible).toBe(5);
    expect(inv.cantidadReservada).toBe(0);
  });

  it('indica que volvió a haber stock cuando se repone desde 0', () => {
    const inv = new Inventario({ productoId: 1, cantidadDisponible: 0 });
    const { volvioAHaberStock } = inv.reponerStock(10);
    expect(volvioAHaberStock).toBe(true);
    expect(inv.cantidadDisponible).toBe(10);
  });
});

describe('Límites de inventario', () => {
  it.each([0, -1, NaN, Infinity, 1.5, '2'])('rechaza cantidad %s sin alterar existencias', cantidad => {
    const inv = new Inventario({ productoId: 1, cantidadDisponible: 5, cantidadReservada: 2 });
    for (const metodo of ['reservarStock', 'liberarStock', 'reponerStock']) {
      expect(() => inv[metodo](cantidad)).toThrow();
      expect(inv.cantidadDisponible).toBe(5);
      expect(inv.cantidadReservada).toBe(2);
    }
  });
  it('no libera más de lo reservado', () => {
    const inv = new Inventario({ productoId: 1, cantidadReservada: 1 });
    expect(() => inv.liberarStock(2)).toThrow(/reservado/);
  });
  it('no anuncia reabastecimiento si ya había existencias', () => {
    const inv = new Inventario({ productoId: 1, cantidadDisponible: 1 });
    expect(inv.reponerStock(2)).toEqual({ volvioAHaberStock: false });
  });
});
