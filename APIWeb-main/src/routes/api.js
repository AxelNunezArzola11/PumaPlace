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
const AbandonarCarrito = require('../use-cases/AbandonarCarrito');
const CrearOrden = require('../use-cases/CrearOrden');
const ConfirmarPago = require('../use-cases/ConfirmarPago');
const ActivarPremium = require('../use-cases/ActivarPremium');
const GenerarCuponPorInactividad = require('../use-cases/GenerarCuponPorInactividad');
const createResourceRoutes = require('./resourceRoutes');
const { auth, requireRole } = require('../middlewares/auth');
const validateBody = require('../middlewares/validateBody');
const MercadoPagoGateway = require('../infrastructure/payments/MercadoPagoGateway');

function createApiRoutes({ eventBus, paymentGateway = null }) {
  const router = express.Router();
  const usuarioRepository = new UsuarioRepository();
  const productoRepository = new ProductoRepository();
  const inventarioRepository = new InventarioRepository();
  const carritoRepository = new CarritoRepository();
  const ordenRepository = new OrdenRepository();

  router.use('/usuarios', createResourceRoutes({
    repository: new CrudRepository(models.Usuario),
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
  router.patch('/usuarios/:id/vendedor', auth(), requireRole('comprador'), async (req, res, next) => {
    try {
      if (String(req.user.sub) !== String(req.params.id)) {
        return res.status(403).json({ success: false, message: 'Solo puedes modificar tu propio usuario' });
      }
      const data = await new ConvertirEnVendedor({ usuarioRepository }).execute(req.params.id);
      return res.json({ success: true, data, message: 'Usuario convertido en vendedor' });
    } catch (error) {
      return next(error);
    }
  });
  router.use('/categorias', createResourceRoutes({
    repository: new CrudRepository(models.Categoria),
    createFields: ['nombre', 'descripcion'],
    updateFields: ['nombre', 'descripcion'],
    requiredFields: ['nombre'],
  }));
  router.use('/productos', createResourceRoutes({
    repository: productoRepository,
    createUseCase: new PublicarProducto({
      usuarioRepository,
      productoRepository,
      inventarioRepository,
    }),
    updateFields: ['nombre', 'descripcion', 'precio', 'estado', 'categoriaId'],
    role: 'vendedor',
    mapCreateBody: (body, req) => ({ ...body, vendedorId: req.user.sub }),
    requiredFields: ['categoriaId', 'nombre', 'descripcion', 'precio'],
  }));
  router.use('/inventario', createResourceRoutes({
    repository: new CrudRepository(models.Inventario),
    createFields: ['productoId', 'cantidadDisponible', 'cantidadReservada'],
    updateFields: ['cantidadDisponible', 'cantidadReservada'],
    requiredFields: ['productoId'],
  }));
  router.use('/carrito', createResourceRoutes({
    repository: carritoRepository,
    updateFields: ['items', 'estado'],
  }));
  router.post('/carrito/items', auth(), validateBody(['productoId']), async (req, res, next) => {
    try {
      const data = await new AgregarAlCarrito({ carritoRepository }).execute({
        usuarioId: req.user.sub,
        productoId: req.body.productoId,
        cantidad: req.body.cantidad,
      });
      return res.status(200).json({ success: true, data, message: 'Producto agregado al carrito' });
    } catch (error) {
      return next(error);
    }
  });
  router.post('/carrito/:id/abandonar', auth(), async (req, res, next) => {
    try {
      const data = await new AbandonarCarrito({ carritoRepository, eventBus }).execute(req.params.id);
      return res.json({ success: true, data, message: 'Carrito abandonado' });
    } catch (error) {
      return next(error);
    }
  });
  router.use('/cupones', createResourceRoutes({
    repository: new CrudRepository(models.Cupon),
    createUseCase: new GenerarCuponPorInactividad({ cuponRepository: new CuponRepository() }),
  }));
  router.use('/ordenes', createResourceRoutes({
    repository: ordenRepository,
    updateFields: ['puntoEntrega'],
  }));
  router.post('/ordenes', auth(), validateBody([]), async (req, res, next) => {
    try {
      const data = await new CrearOrden({
        carritoRepository,
        productoRepository,
        ordenRepository,
        eventBus,
      }).execute({
        usuarioId: req.user.sub,
        puntoEntrega: req.body.puntoEntrega,
        descuento: req.body.descuento || 0,
      });
      return res.status(201).json({ success: true, data, message: 'Orden creada' });
    } catch (error) {
      return next(error);
    }
  });
  router.use('/pagos', createResourceRoutes({
    repository: new CrudRepository(models.Pago),
  }));
  router.post('/pagos/preferencia', auth(), validateBody(['ordenId']), async (req, res, next) => {
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
  router.post('/pagos/:ordenId/confirmar', auth(), async (req, res, next) => {
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
    updateFields: ['enviada'],
  }));
  router.use('/seguimiento-stock', createResourceRoutes({
    repository: new CrudRepository(models.SeguimientoStock),
    createFields: ['usuarioId', 'productoId', 'activo'],
    updateFields: ['activo'],
    requiredFields: ['productoId'],
  }));
  router.use('/suscripciones', createResourceRoutes({
    repository: new CrudRepository(models.Suscripcion),
  }));
  router.post('/suscripciones/premium', auth(), async (req, res, next) => {
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
