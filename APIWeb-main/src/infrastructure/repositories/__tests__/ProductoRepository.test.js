const ProductoRepository = require('../ProductoRepository');

describe('ProductoRepository', () => {
  it('elimina el inventario antes que el producto', async () => {
    const orden = [];
    const record = {
      destroy: jest.fn().mockImplementation(async () => { orden.push('producto'); }),
    };
    const model = { findByPk: jest.fn().mockResolvedValue(record) };
    const inventarioModel = {
      destroy: jest.fn().mockImplementation(async () => { orden.push('inventario'); }),
    };

    const repository = new ProductoRepository({ model, inventarioModel });

    await expect(repository.deleteById(7)).resolves.toBe(true);
    expect(inventarioModel.destroy).toHaveBeenCalledWith({ where: { productoId: 7 } });
    expect(record.destroy).toHaveBeenCalled();
    expect(orden).toEqual(['inventario', 'producto']);
  });

  it('devuelve false cuando el producto no existe', async () => {
    const repository = new ProductoRepository({
      model: { findByPk: jest.fn().mockResolvedValue(null) },
      inventarioModel: { destroy: jest.fn() },
    });

    await expect(repository.deleteById(99)).resolves.toBe(false);
  });
});
