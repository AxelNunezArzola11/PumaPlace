const EventBus = require('../../domain/events/EventBus');
const RegistrarUsuario = require('../RegistrarUsuario');
const ConvertirEnVendedor = require('../ConvertirEnVendedor');
const PublicarProducto = require('../PublicarProducto');
const AgregarAlCarrito = require('../AgregarAlCarrito');
const AbandonarCarrito = require('../AbandonarCarrito');
const CrearOrden = require('../CrearOrden');
const ConfirmarPago = require('../ConfirmarPago');
const GenerarCuponPorInactividad = require('../GenerarCuponPorInactividad');
const ActivarPremium = require('../ActivarPremium');

describe('casos de uso', () => {
  it('registra usuarios solo con consentimiento', async () => {
    const repository = { create: jest.fn().mockResolvedValue({ id: 1, edad: 20 }) };
    const useCase = new RegistrarUsuario({ usuarioRepository: repository });

    await expect(useCase.execute({ edad: 20 })).rejects.toThrow(/consentimiento/i);
    await useCase.execute({ edad: 20, consentimientoDatos: true });

    expect(repository.create).toHaveBeenCalledWith(expect.objectContaining({
      edad: 20,
      consentimientoDatos: true,
    }));
  });

  it('convierte un usuario existente en vendedor', async () => {
    const repository = {
      findById: jest.fn().mockResolvedValue({ id: 1, rol: 'comprador' }),
      updateById: jest.fn().mockResolvedValue({ id: 1, rol: 'vendedor' }),
    };

    await new ConvertirEnVendedor({ usuarioRepository: repository }).execute(1);

    expect(repository.updateById).toHaveBeenCalledWith(1, { rol: 'vendedor' });
  });

  it('limita productos del plan free a cinco', async () => {
    const usuarioRepository = { findById: jest.fn().mockResolvedValue({ id: 1, rol: 'vendedor', plan: 'free' }) };
    const productoRepository = {
      countByVendedor: jest.fn().mockResolvedValue(5),
      create: jest.fn(),
    };
    const useCase = new PublicarProducto({ usuarioRepository, productoRepository });

    await expect(useCase.execute({ vendedorId: 1, categoriaId: 2, nombre: 'Libro', descripcion: 'Usado', precio: 50 }))
      .rejects.toThrow(/5 productos/i);
    expect(productoRepository.create).not.toHaveBeenCalled();
  });

  it('agrega artículos acumulando cantidades en el carrito', async () => {
    const repository = {
      findActiveByUsuarioId: jest.fn().mockResolvedValue({
        id: 4, usuarioId: 1, items: [{ productoId: 9, cantidad: 1 }], estado: 'activo',
      }),
      save: jest.fn().mockImplementation(async (data) => data),
    };

    const result = await new AgregarAlCarrito({ carritoRepository: repository })
      .execute({ usuarioId: 1, productoId: 9, cantidad: 2 });

    expect(result.items).toEqual([{ productoId: 9, cantidad: 3 }]);
  });

  it('abandona el carrito y publica el evento', async () => {
    const eventBus = new EventBus();
    const publish = jest.spyOn(eventBus, 'publish');
    const repository = {
      findById: jest.fn().mockResolvedValue({ id: 4, usuarioId: 1, items: [{ productoId: 9, cantidad: 1 }], estado: 'activo' }),
      save: jest.fn().mockImplementation(async (data) => data),
    };

    await new AbandonarCarrito({ carritoRepository: repository, eventBus }).execute(4);

    expect(publish).toHaveBeenCalledWith(EventBus.EVENTS.CART_ABANDONED, expect.objectContaining({ usuarioId: 1 }));
  });

  it('crea una orden calculando las líneas con precios del repositorio', async () => {
    const eventBus = new EventBus();
    const publish = jest.spyOn(eventBus, 'publish');
    const repositories = {
      carritoRepository: {
        findActiveByUsuarioId: jest.fn().mockResolvedValue({
          id: 4, usuarioId: 1, items: [{ productoId: 9, cantidad: 2 }], estado: 'activo',
        }),
        save: jest.fn().mockResolvedValue(undefined),
      },
      productoRepository: { findById: jest.fn().mockResolvedValue({ id: 9, precio: '12.50' }) },
      ordenRepository: { create: jest.fn().mockImplementation(async (data) => ({ id: 8, ...data })) },
    };

    const result = await new CrearOrden({ ...repositories, eventBus })
      .execute({ usuarioId: 1, descuento: 5 });

    expect(result.total).toEqual({ subtotal: 25, total: 20 });
    expect(repositories.ordenRepository.create).toHaveBeenCalledWith(expect.objectContaining({
      lineas: [{ productoId: 9, cantidad: 2, precioUnitario: 12.5 }],
    }));
    expect(publish).toHaveBeenCalledWith(EventBus.EVENTS.ORDER_CREATED, expect.any(Object));
  });

  it('confirma el pago usando el total persistido, no un monto del cliente', async () => {
    const eventBus = new EventBus();
    const publish = jest.spyOn(eventBus, 'publish');
    const repositories = {
      ordenRepository: {
        findById: jest.fn().mockResolvedValue({
          id: 8, compradorId: 1, descuento: 0,
          lineas: [{ productoId: 9, cantidad: 2, precioUnitario: 12.5 }],
        }),
        save: jest.fn().mockResolvedValue({ id: 8, estado: 'pagada' }),
      },
      pagoRepository: { create: jest.fn().mockImplementation(async (data) => ({ id: 2, ...data })) },
      reciboRepository: { create: jest.fn().mockImplementation(async (data) => ({ id: 3, ...data })) },
    };

    const result = await new ConfirmarPago({ ...repositories, eventBus })
      .execute({ ordenId: 8, metodo: 'mercado_pago', monto: 1, gatewayConfirmed: true });

    expect(repositories.pagoRepository.create).toHaveBeenCalledWith(expect.objectContaining({ monto: 25 }));
    expect(result.pago.monto).toBe(25);
    expect(publish).toHaveBeenCalledWith(EventBus.EVENTS.ORDER_PAID, expect.any(Object));
  });

  it('no confirma pagos sin validación del gateway', async () => {
    const useCase = new ConfirmarPago({
      ordenRepository: { findById: jest.fn() },
      pagoRepository: { create: jest.fn() },
      reciboRepository: { create: jest.fn() },
      eventBus: new EventBus(),
    });

    await expect(useCase.execute({ ordenId: 8 })).rejects.toThrow(/gateway/i);
  });

  it('genera un cupón de inactividad', async () => {
    const repository = { create: jest.fn().mockImplementation(async (data) => data) };
    const result = await new GenerarCuponPorInactividad({ cuponRepository: repository }).execute(7);

    expect(result.usuarioId).toBe(7);
    expect(result.codigo).toMatch(/^VUELVE-7-/);
  });

  it('activa premium y publica el evento', async () => {
    const eventBus = new EventBus();
    const publish = jest.spyOn(eventBus, 'publish');
    const repositories = {
      usuarioRepository: {
        findById: jest.fn().mockResolvedValue({ id: 7, plan: 'free' }),
        updateById: jest.fn().mockResolvedValue({ id: 7, plan: 'premium' }),
      },
      suscripcionRepository: {
        findActiveByUsuarioId: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(async (data) => data),
      },
    };

    const result = await new ActivarPremium({ ...repositories, eventBus }).execute(7);

    expect(result.plan).toBe('premium');
    expect(repositories.usuarioRepository.updateById).toHaveBeenCalledWith(7, { plan: 'premium' });
    expect(publish).toHaveBeenCalledWith(EventBus.EVENTS.SUBSCRIPTION_UPGRADED, expect.any(Object));
  });
});
