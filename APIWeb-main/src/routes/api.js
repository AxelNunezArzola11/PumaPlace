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
const ExpirarReservasVencidas = require('../use-cases/ExpirarReservasVencidas');
const ActivarPremium = require('../use-cases/ActivarPremium');
const GenerarCuponPorInactividad = require('../use-cases/GenerarCuponPorInactividad');
const createResourceRoutes = require('./resourceRoutes');
const { auth, requireRole, signToken } = require('../middlewares/auth');
const validateBody = require('../middlewares/validateBody');
const validateProduct = require('../middlewares/validateProduct');
const MercadoPagoGateway = require('../infrastructure/payments/MercadoPagoGateway');
const { Op, Transaction } = require('sequelize');
const EventBus = require('../domain/events/EventBus');
const sequelize = require('../config/database');
const verifyMercadoPagoSignature = require('../middlewares/verifyMercadoPagoSignature');
const { extractPaymentDataId } = require('../middlewares/verifyMercadoPagoSignature');
const requireMaintenanceToken = require('../middlewares/requireMaintenanceToken');

// Preference currency (see MercadoPagoGateway.crearPreferencia): any approved
// payment in another currency is rejected, never confirmed.
const EXPECTED_CURRENCY = 'MXN';
// Reservation policy (explicit, no schema change): a pending/procesando order
// holds stock for at most 30 minutes from creation. Older orders are treated
// as expired on every webhook and preference request — their reservation is
// released instead of confirmed. A background sweeper is still recommended
// (see final report); this lazy check guarantees no reservation is confirmed
// after its TTL even without one.
const RESERVATION_TTL_MS = 30 * 60 * 1000;
const CANCEL_PAYMENT_STATUSES = ['rejected', 'cancelled', 'refunded', 'charged_back', 'expired'];
const TERMINAL_ORDEN_ESTADOS = ['pagada', 'cancelada', 'completada'];

function isReservationExpired(orden, now = Date.now()) {
  if (!orden || TERMINAL_ORDEN_ESTADOS.includes(orden.estado)) return false;
  const created = orden.createdAt ? new Date(orden.createdAt).getTime() : NaN;
  if (!Number.isFinite(created)) return false;
  return now - created > RESERVATION_TTL_MS;
}

function resolveOrdenIdFromPayment(payment) {
  const external = payment?.external_reference != null ? String(payment.external_reference).trim() : '';
  const meta = payment?.metadata?.ordenId != null ? String(payment.metadata.ordenId).trim() : '';
  if (external && meta && external !== meta) {
    const error = new Error('La referencia externa del pago no coincide con la orden');
    error.status = 422;
    error.type = 'REGLA_DE_NEGOCIO';
    throw error;
  }
  return external || meta || null;
}

function evaluarPago({ payment, orden }) {
  if (CANCEL_PAYMENT_STATUSES.includes(payment.status)) {
    return 'cancel';
  }
  if (payment.status !== 'approved') return 'pending';
  const currency = payment.currency_id ?? payment.currencyId ?? null;
  if (currency != null && String(currency).trim() !== ''
    && String(currency).trim().toUpperCase() !== EXPECTED_CURRENCY) {
    const error = new Error('La moneda confirmada por Mercado Pago no coincide con la orden');
    error.status = 422;
    error.type = 'REGLA_DE_NEGOCIO';
    throw error;
  }
  // Cent-exact comparison: float totals (19.99) must never mismatch by 1¢.
  const subtotalCents = (orden.lineas || []).reduce(
    (sum, linea) => sum + Math.round(Number(linea.precioUnitario) * 100) * Number(linea.cantidad),
    0,
  );
  const expectedCents = subtotalCents - Math.round(Number(orden.descuento || 0) * 100);
  const paidCents = Math.round(Number(payment.transaction_amount) * 100);
  if (!Number.isFinite(paidCents) || paidCents !== expectedCents) {
    const error = new Error('El monto confirmado por Mercado Pago no coincide con la orden');
    error.status = 422;
    error.type = 'REGLA_DE_NEGOCIO';
    throw error;
  }
  return 'approved';
}

async function commitReservationInTx(orden, txOptions) {
  const inventarioRepository = new InventarioRepository();
  for (const linea of orden.lineas || []) {
    const ok = await inventarioRepository.commitReservation(
      linea.productoId, Number(linea.cantidad), txOptions,
    );
    if (!ok) {
      const error = new Error(`No hay suficiente stock para el producto ${linea.productoId}`);
      error.status = 422;
      error.type = 'REGLA_DE_NEGOCIO';
      throw error;
    }
  }
}

async function releaseReservationInTx(orden, txOptions) {
  const inventarioRepository = new InventarioRepository();
  for (const linea of orden.lineas || []) {
    const cantidad = Number(linea.cantidad);
    // A corrupt line must never block a cancellation (or poison MP retries):
    // it is skipped loudly instead of aborting the transaction.
    if (!Number.isSafeInteger(cantidad) || cantidad <= 0) {
      console.error(`[webhook] línea inválida en orden ${orden.id}; se omite su liberación`);
      continue;
    }
    // Tolerant by design: an already-released (or never-reserved) line
    // returns false instead of blocking the cancellation.
    await inventarioRepository.releaseReservation(linea.productoId, cantidad, txOptions);
  }
}

/**
 * Best-effort release outside a transaction (user cancel, preference
 * failure, TTL expiry on reads). Returns true when every valid line was
 * released; false delegates to InventoryListener via an unflagged event.
 * Invalid lines are skipped; a DB failure returns false (the caller then
 * publishes an unflagged event so the listener attempts the release).
 */
async function liberarReservaAbierta(orden, inventarioRepository) {
  for (const linea of orden.lineas || []) {
    const cantidad = Number(linea?.cantidad);
    if (!Number.isSafeInteger(cantidad) || cantidad <= 0) continue;
    try {
      await inventarioRepository.releaseReservation(linea.productoId, cantidad);
    } catch (error) {
      console.error(`[liberar] orden ${orden?.id}: ${error.message}`);
      return false;
    }
  }
  return true;
}

function createApiRoutes({ eventBus, paymentGateway = null, runInTransaction = null }) {
  const router = express.Router();
  // Injectable so route tests can run without a database; production always
  // uses a real Sequelize transaction (TiDB/MySQL InnoDB).
  const withTransaction = runInTransaction
    || ((work) => sequelize.transaction((transaction) => work({ transaction })));
  const usuarioRepository = new UsuarioRepository();
  const productoRepository = new ProductoRepository();
  const inventarioRepository = new InventarioRepository();
  const carritoRepository = new CarritoRepository();
  const ordenRepository = new OrdenRepository();
  const authenticate = auth({ usuarioRepository });

  // Users may only read or modify their OWN profile. There is no admin
  // role in this project, so cross-user access is denied by default.
  const selfOnly = (req, res, next) => {
    if (String(req.user.sub) !== String(req.params.id)) {
      return res.status(403).json({ success: false, message: 'Solo puedes acceder a tu propio usuario' });
    }
    return next();
  };

  const notificacionRepository = new CrudRepository(models.Notificacion);
  const seguimientoStockRepository = new CrudRepository(models.SeguimientoStock);
  const inventarioCrud = new CrudRepository(models.Inventario);

  // Generic owner check for resources carrying their owner's id directly.
  const ownerOf = (repository, ownerField, resourceName) => async (req, res, next) => {
    try {
      const resource = await repository.findById(req.params.id);
      if (!resource) {
        return res.status(404).json({ success: false, message: `${resourceName} no encontrado` });
      }
      if (String(resource[ownerField]) !== String(req.user.sub)) {
        return res.status(403).json({ success: false, message: `No tienes acceso a este ${resourceName.toLowerCase()}` });
      }
      return next();
    } catch (error) {
      return next(error);
    }
  };

  const ordenOwner = ownerOf(ordenRepository, 'compradorId', 'Orden');
  const notificacionOwner = ownerOf(notificacionRepository, 'usuarioId', 'Notificacion');
  const seguimientoOwner = ownerOf(seguimientoStockRepository, 'usuarioId', 'Registro');

  // Inventory belongs to whoever sells the product: resolve ownership
  // through productoId, never from request-body values.
  const inventarioOwner = async (req, res, next) => {
    try {
      const registro = await inventarioCrud.findById(req.params.id);
      if (!registro) return res.status(404).json({ success: false, message: 'Inventario no encontrado' });
      const producto = await productoRepository.findById(registro.productoId);
      if (!producto || String(producto.vendedorId) !== String(req.user.sub)) {
        return res.status(403).json({ success: false, message: 'No tienes acceso a este inventario' });
      }
      return next();
    } catch (error) {
      return next(error);
    }
  };

  router.use('/usuarios', createResourceRoutes({
    repository: new CrudRepository(models.Usuario),
    authMiddleware: authenticate,
    // HIGH-1 fix: `rol` and `plan` are NOT editable here. Role changes go
    // through PATCH /usuarios/:id/vendedor (self + validated use-case);
    // there is no secure admin workflow, so anything else is denied.
    updateFields: ['edad'],
    authorizeUpdate: selfOnly,
    authorizeGet: selfOnly,
    listOptions: (req) => ({ where: { id: req.user.sub } }),
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
  // Shared catalog: public reads. All mutations denied by default — there
  // is no admin role, and no established workflow creates or renames
  // categories through this API (publishing references existing ones).
  router.use('/categorias', createResourceRoutes({
    repository: new CrudRepository(models.Categoria),
    authMiddleware: authenticate,
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
    // The ONLY generic DELETE kept: sellers deleting their OWN products.
    // Every other mount denies deletion by default (no `deletable` flag).
    deletable: true,
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
  // Stock levels: only the product's vendor may restock, and only the
  // available quantity. cantidadReservada is reservation state owned by the
  // order flow — never directly writable. Creation happens inside product
  // publishing, so POST is denied.
  router.use('/inventario', createResourceRoutes({
    repository: inventarioCrud,
    authMiddleware: authenticate,
    updateFields: ['cantidadDisponible'],
    authorizeUpdate: inventarioOwner,
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
  // Cart writes go through the dedicated /items, /activo and /abandonar
  // routes (all identity-scoped). The generic PATCH never worked — the
  // repository has no updateById — so it is removed instead of crashing.
  router.use('/carrito', createResourceRoutes({
    repository: carritoRepository,
    authMiddleware: authenticate,
  }));
  router.post('/carrito/:id/abandonar', authenticate, async (req, res, next) => {
    try {
      const carrito = await carritoRepository.findById(req.params.id);
      if (!carrito) return res.status(404).json({ success: false, message: 'Carrito no encontrado' });
      if (String(carrito.usuarioId) !== String(req.user.sub)) {
        return res.status(403).json({ success: false, message: 'No tienes acceso a este carrito' });
      }
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
    authorizeUpdate: ordenOwner,
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
  // Opportunistic expiry sweep. Render Free has no background workers or
  // cron and sleeps on idle, so automatic expiry ALSO runs piggyback on
  // checkout (see POST /ordenes) plus the explicit endpoint below for an
  // external free scheduler. Best effort by contract: it never throws, so a
  // sweep failure can never break the request that triggered it.
  const barrerReservasVencidas = async (limite) => {
    try {
      const resultado = await new ExpirarReservasVencidas({
        ordenRepository,
        inventarioRepository,
        eventBus,
        ttlMs: RESERVATION_TTL_MS,
        batchLimit: limite,
      }).execute();
      if (resultado.fallos.length > 0) {
        console.error(`[expiracion] ${resultado.fallos.length} fallos al expirar reservas`);
      }
      return resultado;
    } catch (error) {
      console.error(`[expiracion] barrido fallido: ${error.message}`);
      return { expiradas: 0, ids: [], fallos: [{ ordenId: null, message: error.message }] };
    }
  };

  router.post('/ordenes', authenticate, validateBody([]), async (req, res, next) => {
    try {
      // Every checkout first frees stock held by reservations past their TTL,
      // so an abandoned cart can never block a new purchase.
      await barrerReservasVencidas(25);
      const data = await new CrearOrden({
        carritoRepository,
        productoRepository,
        ordenRepository,
        eventBus,
        inventarioRepository,
      }).execute({
        usuarioId: req.user.sub,
        puntoEntrega: req.body.puntoEntrega,
        // Client totals are never trusted: no coupon-redemption flow is wired
        // to orders, so the discount is always 0. A forged descuento in the
        // body is silently ignored instead of applied.
        descuento: 0,
      });
      return res.status(201).json({ success: true, data, message: 'Orden creada' });
    } catch (error) {
      return next(error);
    }
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
      // Atomic claim: exactly one concurrent actor (this cancel, a payment
      // approval, the expiry sweeper) wins the transition. Losers get false
      // and must NOT touch stock — a cancel can never release an approved
      // order, and duplicates are harmless.
      const claimed = await ordenRepository.cancelIfOpen(orden.id);
      if (!claimed) {
        return res.status(409).json({ success: false, message: 'La orden ya fue procesada' });
      }
      const cancelled = { ...orden, estado: 'cancelada' };
      // Release runs BEFORE the event: even if publication failed, the stock
      // is already freed and a retry is a harmless 409.
      const liberada = await liberarReservaAbierta(orden, inventarioRepository);
      eventBus.publish(EventBus.EVENTS.ORDER_CANCELLED, {
        orden: cancelled,
        ...(liberada ? { stockReleased: true } : {}),
      });
      return res.json({
        success: true,
        data: cancelled,
        message: liberada ? 'Orden cancelada y reserva liberada' : 'Orden cancelada; liberación de reserva en curso',
      });
    } catch (error) {
      return next(error);
    }
  });
  // Expiry sweeper trigger. Safe to call any time: idempotent, bounded
  // batch, only touches expired open orders. Dedicated service credential
  // ONLY (MAINTENANCE_TOKEN): ordinary buyers, sellers, and dual users are
  // all rejected, since there is no admin role in this project. External
  // schedulers (GitHub Actions schedule, cron-job.org) call it with the
  // service token; traffic-triggered piggyback covers the rest.
  router.post('/mantenimiento/expirar-reservas', requireMaintenanceToken, async (req, res, next) => {
    try {
      const resultado = await new ExpirarReservasVencidas({
        ordenRepository,
        inventarioRepository,
        eventBus,
        ttlMs: RESERVATION_TTL_MS,
        batchLimit: 100,
      }).execute();
      return res.json({ success: true, data: resultado, message: `Reservas expiradas: ${resultado.expiradas}` });
    } catch (error) {
      return next(error);
    }
  });
  router.use('/pagos', createResourceRoutes({
    repository: new CrudRepository(models.Pago),
    authMiddleware: authenticate,
  }));
  router.post('/pagos/preferencia', authenticate, validateBody(['ordenId']), async (req, res, next) => {
    let orden;
    try {
      orden = await ordenRepository.findById(req.body.ordenId);
      if (!orden) return res.status(404).json({ success: false, message: 'Orden no encontrada' });
      if (String(orden.compradorId) !== String(req.user.sub)) {
        return res.status(403).json({ success: false, message: 'La orden no pertenece al usuario autenticado' });
      }
      // A preference is NOT a purchase: it never confirms the order. Paid or
      // cancelled orders cannot start a new checkout.
      if (['pagada', 'completada'].includes(orden.estado)) {
        return res.status(422).json({ success: false, message: 'La orden ya está pagada' });
      }
      if (orden.estado === 'cancelada') {
        return res.status(422).json({ success: false, message: 'La orden está cancelada' });
      }
      if (isReservationExpired(orden)) {
        // Conditional claim: a payment approved between our read and this
        // write must win — never overwrite pagada with cancelada.
        const claimed = await ordenRepository.cancelIfOpen(orden.id);
        if (!claimed) {
          const actual = await ordenRepository.findById(req.body.ordenId);
          if (actual && ['pagada', 'completada'].includes(actual.estado)) {
            return res.status(422).json({ success: false, message: 'La orden ya está pagada' });
          }
          return res.status(409).json({ success: false, message: 'La orden ya fue procesada' });
        }
        const liberada = await liberarReservaAbierta(orden, inventarioRepository);
        eventBus.publish(EventBus.EVENTS.ORDER_CANCELLED, {
          orden: { ...orden, estado: 'cancelada' },
          ...(liberada ? { stockReleased: true } : {}),
        });
        return res.status(410).json({ success: false, message: 'La reserva de la orden expiró; crea una nueva orden' });
      }
      const preference = await (paymentGateway || new MercadoPagoGateway()).crearPreferencia(orden);
      // PAYMENT_PENDING: a preference exists and the webhook has not arrived
      // yet. Best effort — if this save fails the order stays pendiente,
      // which is still payable through the created preference.
      if (orden.estado === 'pendiente') {
        try {
          await ordenRepository.save(orden.id, { estado: 'procesando' });
        } catch (transitionError) {
          console.error(`[preferencia] no se pudo marcar la orden ${orden.id} como procesando: ${transitionError.message}`);
        }
      }
      return res.status(201).json({ success: true, data: preference, message: 'Preferencia de pago creada' });
    } catch (error) {
      // Conditional claim on the STALE pre-read: when preference creation
      // fails after a concurrent approval (double checkout), the paid order
      // must survive — only an actually-open order is cancelled here, so a
      // failed setup never strands a reservation and never kills a payment.
      if (orden) {
        const claimed = await ordenRepository.cancelIfOpen(orden.id);
        if (claimed) {
          const liberada = await liberarReservaAbierta(orden, inventarioRepository);
          eventBus.publish(EventBus.EVENTS.ORDER_CANCELLED, {
            orden: { ...orden, estado: 'cancelada' },
            ...(liberada ? { stockReleased: true } : {}),
          });
        }
      }
      return next(error);
    }
  });
  router.post('/pagos/webhook', verifyMercadoPagoSignature, async (req, res, next) => {
    try {
      // 1. Re-query the Mercado Pago API: the notification payload itself is
      // NEVER trusted for status or amount.
      const paymentId = extractPaymentDataId(req);
      const payment = await (paymentGateway || new MercadoPagoGateway()).consultarPago(paymentId);
      const ordenId = resolveOrdenIdFromPayment(payment);
      if (!ordenId) {
        const error = new Error('El pago no tiene una orden asociada');
        error.status = 422;
        error.type = 'REGLA_DE_NEGOCIO';
        throw error;
      }
      // 2. Every read and write inside ONE transaction, so a crash or a
      // retried delivery can never leave a half-confirmed payment.
      const outcome = await withTransaction(async (txOptions) => {
        // Row lock (production only: stub runners pass no real transaction).
        // Serializes concurrent deliveries, cancels and sweeps on this order:
        // the loser blocks, then re-reads the winner's terminal estado.
        // TiDB runs pessimistic transactions by default, so FOR UPDATE holds;
        // under an optimistic mode a write conflict would surface as an error
        // instead — Mercado Pago retries, and the retry lands here as
        // already-processed. Correct under both modes.
        const readOptions = txOptions.transaction && typeof txOptions.transaction === 'object'
          ? { ...txOptions, lock: Transaction.LOCK.UPDATE }
          : txOptions;
        const orden = await ordenRepository.findById(ordenId, readOptions);
        if (!orden) return { type: 'orden-not-found' };
        if (TERMINAL_ORDEN_ESTADOS.includes(orden.estado)) {
          return { type: 'already-processed', orden };
        }
        // Lazy reservation expiry wins over any payment verdict: an abandoned
        // checkout releases stock instead of confirming, even for a late
        // approved notification.
        if (isReservationExpired(orden)) {
          const cancelled = await ordenRepository.save(ordenId, { estado: 'cancelada' }, txOptions);
          await releaseReservationInTx(orden, txOptions);
          return { type: 'cancelled', orden: cancelled, reason: 'expired' };
        }
        const paymentAction = evaluarPago({ payment, orden });
        if (paymentAction === 'cancel') {
          const cancelled = await ordenRepository.save(ordenId, { estado: 'cancelada' }, txOptions);
          await releaseReservationInTx(orden, txOptions);
          return { type: 'cancelled', orden: cancelled };
        }
        if (paymentAction === 'pending') {
          return { type: 'pending', orden };
        }
        const data = await new ConfirmarPago({
          ordenRepository,
          pagoRepository: new PagoRepository(),
          reciboRepository: new ReciboTransaccionRepository(),
          eventBus,
        }).execute(
          { ordenId, metodo: 'mercado_pago', gatewayConfirmed: true, gatewayPaymentId: paymentId },
          { transaction: txOptions.transaction || null, deferEvents: true },
        );
        // Inventory is committed in the SAME transaction: when stock cannot
        // cover the order, everything rolls back — no partial purchase.
        await commitReservationInTx(orden, txOptions);
        return { type: 'confirmed', data };
      });
      // 3. Side effects and responses only AFTER the transaction commits.
      // The stock flags tell InventoryListener the reservation was already
      // settled in-transaction, so it must not apply it a second time.
      if (outcome.type === 'orden-not-found') {
        return res.status(404).json({ success: false, message: 'Orden no encontrada' });
      }
      if (outcome.type === 'already-processed') {
        return res.status(200).json({ success: true, message: 'El pago ya había sido procesado' });
      }
      if (outcome.type === 'cancelled') {
        eventBus.publish(EventBus.EVENTS.ORDER_CANCELLED, { orden: outcome.orden, stockReleased: true });
        const message = outcome.reason === 'expired'
          ? 'La reserva expiró; stock liberado'
          : 'Pago rechazado; reserva liberada';
        return res.status(200).json({ success: true, data: outcome.orden, message });
      }
      if (outcome.type === 'pending') {
        return res.status(200).json({ success: true, data: { estado: outcome.orden.estado }, message: 'Pago pendiente; no se ha vendido el producto' });
      }
      eventBus.publish(EventBus.EVENTS.ORDER_PAID, {
        orden: outcome.data.orden,
        pago: outcome.data.pago,
        recibo: outcome.data.recibo,
        stockCommitted: true,
      });
      return res.status(200).json({ success: true, data: outcome.data, message: 'Pago confirmado por Mercado Pago' });
    } catch (error) {
      // Race backstop: two deliveries committing at once → the loser hits the
      // UNIQUE constraint on pagos.ordenId and safely reports "already
      // processed" so Mercado Pago stops retrying.
      if (error && error.name === 'SequelizeUniqueConstraintError') {
        return res.status(200).json({ success: true, message: 'El pago ya había sido procesado' });
      }
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
    repository: notificacionRepository,
    authMiddleware: authenticate,
    updateFields: ['enviada'],
    authorizeUpdate: notificacionOwner,
  }));
  router.use('/seguimiento-stock', createResourceRoutes({
    repository: seguimientoStockRepository,
    authMiddleware: authenticate,
    createFields: ['usuarioId', 'productoId', 'activo'],
    updateFields: ['activo'],
    requiredFields: ['productoId'],
    // Follows are always created for the caller: a forged usuarioId in the
    // body can never subscribe (or pollute) another user.
    mapCreateBody: (body, req) => ({ ...body, usuarioId: req.user.sub }),
    authorizeUpdate: seguimientoOwner,
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
module.exports.isReservationExpired = isReservationExpired;
module.exports.resolveOrdenIdFromPayment = resolveOrdenIdFromPayment;
module.exports.RESERVATION_TTL_MS = RESERVATION_TTL_MS;
module.exports.EXPECTED_CURRENCY = EXPECTED_CURRENCY;
