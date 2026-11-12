const express = require('express');
const models = require('../infrastructure/models');
const CrudRepository = require('../infrastructure/repositories/CrudRepository');
const UsuarioRepository = require('../infrastructure/repositories/UsuarioRepository');
const ProductoRepository = require('../infrastructure/repositories/ProductoRepository');
const InventarioRepository = require('../infrastructure/repositories/InventarioRepository');
const CarritoRepository = require('../infrastructure/repositories/CarritoRepository');
const OrdenRepository = require('../infrastructure/repositories/OrdenRepository');
const PagoRepository = require('../infrastructure/repositories/PagoRepository');
const ReciboTransaccionRepository = require('../infrastructure/repositories/ReciboTransaccionRepository');
const SuscripcionRepository = require('../infrastructure/repositories/SuscripcionRepository');
const CuponRepository = require('../infrastructure/repositories/CuponRepository');
const ConvertirEnVendedor = require('../use-cases/ConvertirEnVendedor');
const PublicarProducto = require('../use-cases/PublicarProducto');
const AgregarAlCarrito = require('../use-cases/AgregarAlCarrito');
const SincronizarCarrito = require('../use-cases/SincronizarCarrito');
const AbandonarCarrito = require('../use-cases/AbandonarCarrito');
const CrearOrden = require('../use-cases/CrearOrden');
const ConfirmarPago = require('../use-cases/ConfirmarPago');
const ActivarPremium = require('../use-cases/ActivarPremium');
const GenerarCuponPorInactividad = require('../use-cases/GenerarCuponPorInactividad');
const createResourceRoutes = require('./resourceRoutes');
const { auth, requireRole, signToken } = require('../middlewares/auth');
const validateBody = require('../middlewares/validateBody');
const validateProduct = require('../middlewares/validateProduct');
const MercadoPagoGateway = require('../infrastructure/payments/MercadoPagoGateway');
const { Op } = require('sequelize');
const EventBus = require('../domain/events/EventBus');

function evaluarPago({ payment, orden }) {
  if (['rejected', 'cancelled', 'refunded', 'charged_back'].includes(payment.status)) {
    return 'cancel';
  }
  if (payment.status !== 'approved') return 'pending';
  const total = (orden.lineas || []).reduce(
    (sum, linea) => sum + Math.round(Number(linea.precioUnitario) * 100) * Number(linea.cantidad),
    0,
  ) / 100 - Number(orden.descuento || 0);
  if (Number(payment.transaction_amount) !== Number(total)) {
    const error = new Error('El monto confirmado por Mercado Pago no coincide con la orden');
    error.status = 422;
    error.type = 'REGLA_DE_NEGOCIO';
    throw error;
  }
  return 'approved';
}

function createApiRoutes({ eventBus, paymentGateway = null }) {
  const router = express.Router();
  const usuarioRepository = new UsuarioRepository();
  const productoRepository = new ProductoRepository();
  const inventarioRepository = new InventarioRepository();
  const carritoRepository = new CarritoRepository();
  const ordenRepository = new OrdenRepository();
  const authenticate = auth({ usuarioRepository });

  router.use('/usuarios', createResourceRoutes({
    repository: new CrudRepository(models.Usuario),
    authMiddleware: authenticate,
    updateFields: ['edad', 'rol', 'plan'],
    serialize: (data) => {
      const sanitize = (usuario) => {
        if (!usuario) return usuario;
        const { passwordHash, ...safe } = usuario;
        return safe;
      };
      return Array.isArray(data) ? data.map(sanitize) : sanitize(data);
    },
  }));
  router.patch('/usuarios/:id/vendedor', authenticate, requireRole('comprador'), async (req, res, next) => {
    try {
      if (String(req.user.sub) !== String(req.params.id)) {
        return res.status(403).json({ success: false, message: 'Solo puedes modificar tu propio usuario' });
      }
      const data = await new ConvertirEnVendedor({ usuarioRepository }).execute(req.params.id, req.body);
      const { passwordHash, ...usuario } = data;
      const token = signToken(usuario);
      return res.json({
        success: true,
        data: { ...usuario, token },
        message: 'Usuario convertido en vendedor',
      });
    } catch (error) {
      return next(error);
    }
  });
  router.use('/categorias', createResourceRoutes({
    repository: new CrudRepository(models.Categoria),
    authMiddleware: authenticate,
    createFields: ['nombre', 'descripcion'],
    updateFields: ['nombre', 'descripcion'],
    requiredFields: ['nombre'],
    publicRead: true,
  }));
  const productOwner = (req, res, next) => {
    productoRepository.findById(req.params.id)
      .then((producto) => {
        if (!producto) {
          return res.status(404).json({ success: false, message: 'Producto no encontrado' });
        }
        if (String(producto.vendedorId) !== String(req.user.sub)) {
          return res.status(403).json({
            success: false,
            message: 'Solo el vendedor dueño puede modificar el producto',
          });
        }
        req.producto = producto;
        return next();
      })
      .catch(next);
  };
  router.use('/productos', createResourceRoutes({
    repository: productoRepository,
    authMiddleware: authenticate,
    createUseCase: new PublicarProducto({
      usuarioRepository,
      productoRepository,
      inventarioRepository,
    }),
    updateFields: ['nombre', 'descripcion', 'precio', 'estado', 'categoriaId', 'imagenUrl', 'cantidadDisponible'],
    role: 'vendedor',
    validateCreate: [validateProduct({ requireStock: true })],
    validateUpdate: [validateProduct()],
    authorizeUpdate: productOwner,
    authorizeDelete: productOwner,
    publicRead: true,
    listOptions: (req) => {
      const { q, categoriaId, precioMin, precioMax, page = 1, limit = 20 } = req.query;
      const parsedPage = Number(page);
      const parsedLimit = Number(limit);
      if (!Number.isInteger(parsedPage) || parsedPage < 1
        || !Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 100) {
        const error = new Error('page y limit deben ser enteros válidos');
        error.status = 400;
        throw error;
      }
      const where = {};
      if (q) where[Op.or] = [
        { nombre: { [Op.like]: `%${String(q).trim()}%` } },
        { descripcion: { [Op.like]: `%${String(q).trim()}%` } },
      ];
      if (categoriaId !== undefined) {
        if (!Number.isSafeInteger(Number(categoriaId)) || Number(categoriaId) <= 0) {
          const error = new Error('categoriaId debe ser un entero positivo');
          error.status = 400;
          throw error;
        }
        where.categoriaId = Number(categoriaId);
      }
      if (precioMin !== undefined || precioMax !== undefined) {
        const price = {};
        if (precioMin !== undefined) price[Op.gte] = Number(precioMin);
        if (precioMax !== undefined) price[Op.lte] = Number(precioMax);
        if (Object.values(price).some((value) => !Number.isFinite(value) || value < 0)) {
          const error = new Error('Los precios deben ser números no negativos');
          error.status = 400;
          throw error;
        }
        where.precio = price;
      }
      return { where, offset: (parsedPage - 1) * parsedLimit, limit: parsedLimit };
    },
    serialize: (data) => {
      const sanitize = (product) => product;
      return Array.isArray(data) ? data.map(sanitize) : sanitize(data);
    },
    mapCreateBody: (body, req) => ({ ...body, vendedorId: req.user.sub }),
    requiredFields: ['categoriaId', 'nombre', 'descripcion', 'precio', 'cantidadDisponible'],
  }));
  router.use('/inventario', createResourceRoutes({
    repository: new CrudRepository(models.Inventario),
    authMiddleware: authenticate,
    createFields: ['productoId', 'cantidadDisponible', 'cantidadReservada'],
    updateFields: ['cantidadDisponible', 'cantidadReservada'],
    requiredFields: ['productoId'],
  }));

  router.get('/carrito/activo', authenticate, async (req, res, next) => {
    try {
      const data = await carritoRepository.findActiveByUsuarioId(req.user.sub);
      return res.json({ success: true, data: data || null, message: 'Consulta exitosa' });
    } catch (error) {
      return next(error);
    }
  });
  router.post('/carrito/items', authenticate, validateBody(['productoId']), async (req, res, next) => {
    try {
      const data = await new AgregarAlCarrito({
        carritoRepository,
        productoRepository,
        inventarioRepository,
      }).execute({
        usuarioId: req.user.sub,
        productoId: req.body.productoId,
        cantidad: req.body.cantidad,
      });
      return res.status(200).json({ success: true, data, message: 'Producto agregado al carrito' });
    } catch (error) {
      return next(error);
    }
  });
  router.put('/carrito/items', authenticate, validateBody(['items']), async (req, res, next) => {
    try {
      const data = await new SincronizarCarrito({
        carritoRepository,
        productoRepository,
        inventarioRepository,
      }).execute({
        usuarioId: req.user.sub,
        items: req.body.items,
      });
      return res.status(200).json({ success: true, data, message: 'Carrito actualizado' });
    } catch (error) {
      return next(error);
    }
  });
  router.use('/carrito', createResourceRoutes({
    repository: carritoRepository,
    authMiddleware: authenticate,
    updateFields: ['items', 'estado'],
  }));
  router.post('/carrito/:id/abandonar', authenticate, async (req, res, next) => {
    try {
      const data = await new AbandonarCarrito({ carritoRepository, eventBus }).execute(req.params.id);
      return res.json({ success: true, data, message: 'Carrito abandonado' });
    } catch (error) {
      return next(error);
    }
  });
  router.use('/cupones', createResourceRoutes({
    repository: new CrudRepository(models.Cupon),
    authMiddleware: authenticate,
    createUseCase: new GenerarCuponPorInactividad({ cuponRepository: new CuponRepository() }),
  }));
  router.use('/ordenes', createResourceRoutes({
    repository: ordenRepository,
    authMiddleware: authenticate,
    updateFields: ['puntoEntrega'],
    listOptions: (req) => ({ where: { compradorId: req.user.sub } }),
    authorizeGet: async (req, res, next) => {
      try {
        const orden = await ordenRepository.findById(req.params.id);
        if (!orden) return res.status(404).json({ success: false, message: 'Orden no encontrada' });
        const productoIds = (orden.lineas || []).map((linea) => linea.productoId);
        const productos = await models.Producto.findAll({ where: { id: productoIds } });
        const esVendedor = productos.some((producto) => String(producto.vendedorId) === String(req.user.sub));
        if (String(orden.compradorId) !== String(req.user.sub) && !esVendedor) {
          return res.status(403).json({ success: false, message: 'No tienes acceso a esta orden' });
        }
        req.ordenAutorizada = orden;
        return next();
      } catch (error) {
        return next(error);
      }
    },
  }));
  router.post('/ordenes', authenticate, validateBody([]), async (req, res, next) => {
    try {
      const data = await new CrearOrden({
        carritoRepository,
        productoRepository,
        ordenRepository,
        eventBus,
        inventarioRepository,
      }).execute({
        usuarioId: req.user.sub,
        puntoEntrega: req.body.puntoEntrega,
        descuento: req.body.descuento || 0,
      });
      router.post('/ordenes/:id/cancelar', authenticate, async (req, res, next) => {
        try {
          const orden = await ordenRepository.findById(req.params.id);
          if (!orden) return res.status(404).json({ success: false, message: 'Orden no encontrada' });
          if (String(orden.compradorId) !== String(req.user.sub)) {
            return res.status(403).json({ success: false, message: 'Sólo el comprador puede cancelar la orden' });
          }
          if (!['pendiente', 'procesando'].includes(orden.estado)) {
            return res.status(422).json({ success: false, message: 'La orden ya no se puede cancelar' });
          }
          const cancelled = await ordenRepository.save(orden.id, { estado: 'cancelada' });
          eventBus.publish(EventBus.EVENTS.ORDER_CANCELLED, { orden: cancelled });
          return res.json({ success: true, data: cancelled, message: 'Orden cancelada y reserva liberada' });
        } catch (error) {
          return next(error);
        }
      });
      return res.status(201).json({ success: true, data, message: 'Orden creada' });
    } catch (error) {
      return next(error);
    }
  });
  router.use('/pagos', createResourceRoutes({
    repository: new CrudRepository(models.Pago),
    authMiddleware: authenticate,
  }));
  router.post('/pagos/preferencia', authenticate, validateBody(['ordenId']), async (req, res, next) => {
    try {
      const orden = await ordenRepository.findById(req.body.ordenId);
      if (!orden) return res.status(404).json({ success: false, message: 'Orden no encontrada' });
      if (String(orden.compradorId) !== String(req.user.sub)) {
        return res.status(403).json({ success: false, message: 'La orden no pertenece al usuario autenticado' });
      }
      const preference = await (paymentGateway || new MercadoPagoGateway()).crearPreferencia(orden);
      return res.status(201).json({ success: true, data: preference, message: 'Preferencia de pago creada' });
    } catch (error) {
      return next(error);
    }
  });
  router.post('/pagos/webhook', async (req, res, next) => {
    try {
      const paymentId = req.body?.data?.id || req.query?.id;
      const payment = await (paymentGateway || new MercadoPagoGateway()).consultarPago(paymentId);
      if (payment.status !== 'approved') return res.status(200).json({ success: true, message: 'Pago aún no aprobado' });
      const ordenId = payment.external_reference || payment.metadata?.ordenId;
      if (!ordenId) throw new Error('El pago aprobado no tiene una orden asociada');
      const orden = await ordenRepository.findById(ordenId);
      if (!orden) return res.status(404).json({ success: false, message: 'Orden no encontrada' });
      if (orden.estado === 'pagada') {
        return res.status(200).json({ success: true, message: 'El pago ya había sido procesado' });
      }
      const paymentAction = evaluarPago({ payment, orden });
      if (paymentAction === 'cancel') {
        const cancelled = await ordenRepository.save(ordenId, { estado: 'cancelada' });
        eventBus.publish(EventBus.EVENTS.ORDER_CANCELLED, { orden: cancelled });
        return res.status(200).json({ success: true, data: cancelled, message: 'Pago rechazado; reserva liberada' });
      }
      if (paymentAction === 'pending') {
        return res.status(200).json({ success: true, data: { estado: orden.estado }, message: 'Pago pendiente; no se ha vendido el producto' });
      }
      const data = await new ConfirmarPago({
        ordenRepository,
        pagoRepository: new PagoRepository(),
        reciboRepository: new ReciboTransaccionRepository(),
        eventBus,
      }).execute({ ordenId, metodo: 'mercado_pago', gatewayConfirmed: true });
      return res.status(200).json({ success: true, data, message: 'Pago confirmado por Mercado Pago' });
    } catch (error) {
      return next(error);
    }
  });
  router.post('/pagos/:ordenId/confirmar', authenticate, async (req, res, next) => {
    try {
      const data = await new ConfirmarPago({
        ordenRepository,
        pagoRepository: new PagoRepository(),
        reciboRepository: new ReciboTransaccionRepository(),
        eventBus,
      }).execute({ ordenId: req.params.ordenId, metodo: req.body.metodo, gatewayConfirmed: false });
      return res.json({ success: true, data, message: 'Pago confirmado' });
    } catch (error) {
      return next(error);
    }
  });
  router.use('/notificaciones', createResourceRoutes({
    repository: new CrudRepository(models.Notificacion),
    authMiddleware: authenticate,
    updateFields: ['enviada'],
  }));
  router.use('/seguimiento-stock', createResourceRoutes({
    repository: new CrudRepository(models.SeguimientoStock),
    authMiddleware: authenticate,
    createFields: ['usuarioId', 'productoId', 'activo'],
    updateFields: ['activo'],
    requiredFields: ['productoId'],
  }));
  router.use('/suscripciones', createResourceRoutes({
    repository: new CrudRepository(models.Suscripcion),
    authMiddleware: authenticate,
  }));
  router.post('/suscripciones/premium', authenticate, async (req, res, next) => {
    try {
      const data = await new ActivarPremium({
        usuarioRepository,
        suscripcionRepository: new SuscripcionRepository(),
        eventBus,
      }).execute(req.user.sub);
      return res.status(201).json({ success: true, data, message: 'Premium activado' });
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

module.exports = createApiRoutes;
module.exports.evaluarPago = evaluarPago;
