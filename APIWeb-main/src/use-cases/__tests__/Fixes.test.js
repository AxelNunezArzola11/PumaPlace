const EventBus = require('../../domain/events/EventBus');
const PublicarProducto = require('../PublicarProducto');
const AgregarAlCarrito = require('../AgregarAlCarrito');
const SincronizarCarrito = require('../SincronizarCarrito');
const CrearOrden = require('../CrearOrden');

const repositorioPublicacion = (overrides = {}) => ({
  usuarioRepository: {
    findById: jest.fn().mockResolvedValue({ id: 1, rol: 'vendedor', plan: 'premium' }),
  },
  productoRepository: {
    countByVendedor: jest.fn().mockResolvedValue(0),
    create: jest.fn().mockResolvedValue({ id: 5 }),
  },
  ...overrides,
});

describe('validación de productos', () => {
  it('rechaza publicar un producto con precio 0', async () => {
    const repos = repositorioPublicacion();
    const useCase = new PublicarProducto(repos);

    await expect(useCase.execute({
      vendedorId: 1,
      categoriaId: 2,
      nombre: 'Laptop',
      descripcion: 'Equipo de cómputo',
      precio: 0,
      cantidadDisponible: 3,
    })).rejects.toThrow(/precio/i);

    expect(repos.productoRepository.create).not.toHaveBeenCalled();
  });

  it('rechaza publicar un producto sin stock', async () => {
    const repos = repositorioPublicacion();
    const useCase = new PublicarProducto(repos);

    await expect(useCase.execute({
      vendedorId: 1,
      categoriaId: 2,
      nombre: 'Laptop',
      descripcion: 'Equipo de cómputo',
      precio: 15000,
      cantidadDisponible: 0,
    })).rejects.toThrow(/al menos 1 unidad/i);

    expect(repos.productoRepository.create).not.toHaveBeenCalled();
  });

  it('crea el inventario con la cantidad publicada', async () => {
    const inventarioRepository = { save: jest.fn().mockResolvedValue({}) };
    const repos = repositorioPublicacion({ inventarioRepository });
    const useCase = new PublicarProducto(repos);

    await useCase.execute({
      vendedorId: 1,
      categoriaId: 2,
      nombre: 'Laptop',
      descripcion: 'Equipo de cómputo',
      precio: 15000,
      cantidadDisponible: 3,
    });

    expect(inventarioRepository.save).toHaveBeenCalledWith({
      productoId: 5,
      cantidadDisponible: 3,
      cantidadReservada: 0,
    });
  });
});

describe('carrito por usuario', () => {
  it('no permite agregar productos propios al carrito', async () => {
    const carritoRepository = {
      findActiveByUsuarioId: jest.fn().mockResolvedValue(null),
      save: jest.fn(),
    };
    const productoRepository = {
      findById: jest.fn().mockResolvedValue({
        id: 9, vendedorId: 1, estado: 'publicado', inventario: { cantidadDisponible: 5 },
      }),
    };

    await expect(new AgregarAlCarrito({ carritoRepository, productoRepository })
      .execute({ usuarioId: 1, productoId: 9, cantidad: 1 }))
      .rejects.toThrow(/propios/i);

    expect(carritoRepository.save).not.toHaveBeenCalled();
  });

  it('rechaza cantidades que superan el stock disponible', async () => {
    const carritoRepository = {
      findActiveByUsuarioId: jest.fn().mockResolvedValue({
        id: 4, usuarioId: 2, items: [{ productoId: 9, cantidad: 1 }], estado: 'activo',
      }),
      save: jest.fn(),
    };
    const productoRepository = {
      findById: jest.fn().mockResolvedValue({
        id: 9, vendedorId: 1, estado: 'publicado', inventario: { cantidadDisponible: 2 },
      }),
    };

    await expect(new AgregarAlCarrito({ carritoRepository, productoRepository })
      .execute({ usuarioId: 2, productoId: 9, cantidad: 2 }))
      .rejects.toThrow(/stock/i);

    expect(carritoRepository.save).not.toHaveBeenCalled();
  });

  it('sincroniza exactamente los artículos enviados por el comprador', async () => {
    const carritoRepository = {
      findActiveByUsuarioId: jest.fn().mockResolvedValue({
        id: 4, usuarioId: 2, items: [{ productoId: 1, cantidad: 5 }], estado: 'activo',
      }),
      save: jest.fn().mockImplementation(async (data) => data),
    };
    const productoRepository = {
      findById: jest.fn().mockResolvedValue({ id: 9, vendedorId: 1, estado: 'publicado' }),
    };
    const inventarioRepository = {
      findByProductoId: jest.fn().mockResolvedValue({ cantidadDisponible: 10 }),
    };

    const result = await new SincronizarCarrito({
      carritoRepository, productoRepository, inventarioRepository,
    }).execute({ usuarioId: 2, items: [{ productoId: 9, cantidad: 2 }] });

    expect(result.items).toEqual([{ productoId: 9, cantidad: 2 }]);
  });
});

describe('reserva de stock al crear la orden', () => {
  const crearRepositorios = () => ({
    carritoRepository: {
      findActiveByUsuarioId: jest.fn().mockResolvedValue({
        id: 4, usuarioId: 1, items: [{ productoId: 9, cantidad: 2 }], estado: 'activo',
      }),
      save: jest.fn().mockResolvedValue(undefined),
    },
    productoRepository: {
      findById: jest.fn().mockResolvedValue({
        id: 9,
        precio: '12.50',
        estado: 'publicado',
        inventario: { productoId: 9, cantidadDisponible: 5, cantidadReservada: 1 },
      }),
    },
    ordenRepository: {
      create: jest.fn().mockImplementation(async (data) => ({ id: 8, ...data })),
    },
    inventarioRepository: { save: jest.fn().mockResolvedValue({}) },
  });

  it('descuenta el stock antes de responder y evita la doble reserva', async () => {
    const eventBus = new EventBus();
    const publish = jest.spyOn(eventBus, 'publish');
    const repos = crearRepositorios();

    await new CrearOrden({ ...repos, eventBus }).execute({ usuarioId: 1 });

    expect(repos.inventarioRepository.save).toHaveBeenCalledWith({
      productoId: 9,
      cantidadDisponible: 3,
      cantidadReservada: 3,
    });
    expect(publish).toHaveBeenCalledWith(
      EventBus.EVENTS.ORDER_CREATED,
      expect.objectContaining({ stockReserved: true }),
    );
  });

  it('restaura el stock si la orden no se puede crear', async () => {
    const eventBus = new EventBus();
    const publish = jest.spyOn(eventBus, 'publish');
    const repos = crearRepositorios();
    repos.ordenRepository.create.mockRejectedValueOnce(new Error('fallo al guardar'));

    await expect(new CrearOrden({ ...repos, eventBus }).execute({ usuarioId: 1 }))
      .rejects.toThrow(/fallo al guardar/);

    expect(repos.inventarioRepository.save).toHaveBeenLastCalledWith({
      productoId: 9,
      cantidadDisponible: 5,
      cantidadReservada: 1,
    });
    expect(publish).not.toHaveBeenCalled();
  });
});
