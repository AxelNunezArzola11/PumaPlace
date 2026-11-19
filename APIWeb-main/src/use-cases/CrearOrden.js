const Orden = require('../domain/entities/Orden');
const Inventario = require('../domain/entities/Inventario');
const { EVENTS } = require('../domain/events/EventBus');

class CrearOrden {
  constructor({
    carritoRepository, productoRepository, ordenRepository, eventBus, inventarioRepository = null,
  } = {}) {
    if (!carritoRepository || !productoRepository || !ordenRepository || !eventBus) {
      throw new Error('CrearOrden requiere repositorios y EventBus');
    }
    this.carritoRepository = carritoRepository;
    this.productoRepository = productoRepository;
    this.ordenRepository = ordenRepository;
    this.eventBus = eventBus;
    this.inventarioRepository = inventarioRepository;
  }

  async execute({ usuarioId, puntoEntrega = null, descuento = 0 }) {
    const carrito = await this.carritoRepository.findActiveByUsuarioId(usuarioId);
    if (!carrito || !carrito.items?.length) throw new Error('El carrito está vacío');

    const orden = new Orden({ compradorId: usuarioId, puntoEntrega, descuento });
    const reservas = [];
    // Atomic path (production): one conditional UPDATE per line, so two
    // simultaneous checkouts cannot oversell. Repositories without the new
    // methods (older mocks) keep the legacy read-modify-save path.
    const usaReservaAtomica = !!this.inventarioRepository
      && typeof this.inventarioRepository.tryReserve === 'function'
      && typeof this.inventarioRepository.releaseReservation === 'function';

    for (const item of carrito.items) {
      const producto = await this.productoRepository.findById(item.productoId);
      if (!producto) throw new Error(`Producto no encontrado: ${item.productoId}`);
      if (producto.estado && producto.estado !== 'publicado') {
        throw new Error(`El producto ${item.productoId} no está disponible para comprar`);
      }
      // Defense in depth: the cart use-cases already block own products, but
      // an order must never be created for the seller's own listing.
      if (producto.vendedorId != null && String(producto.vendedorId) === String(usuarioId)) {
        throw new Error('No puedes comprar tus propios productos');
      }
      orden.agregarLinea(producto.id, item.cantidad, Number(producto.precio));

      if (this.inventarioRepository && !usaReservaAtomica) {
        const registro = producto.inventario
          || await this.inventarioRepository.findByProductoId(item.productoId);
        if (!registro) {
          throw new Error(`No existe inventario para el producto ${item.productoId}`);
        }
        const inventario = new Inventario({
          productoId: item.productoId,
          cantidadDisponible: Number(registro.cantidadDisponible),
          cantidadReservada: Number(registro.cantidadReservada || 0),
        });
        inventario.reservarStock(item.cantidad);
        reservas.push({
          productoId: item.productoId,
          original: {
            cantidadDisponible: Number(registro.cantidadDisponible),
            cantidadReservada: Number(registro.cantidadReservada || 0),
          },
          actualizado: {
            cantidadDisponible: inventario.cantidadDisponible,
            cantidadReservada: inventario.cantidadReservada,
          },
        });
      }
    }

    const total = orden.calcularTotal();
    const aplicadas = [];

    try {
      // Reservamos antes de responder para que el stock visible quede
      // actualizado en cuanto se crea la orden, sin depender de que el
      // listener asíncrono termine después del envío de la respuesta.
      if (this.inventarioRepository && usaReservaAtomica) {
        for (const item of carrito.items) {
          const reservado = await this.inventarioRepository.tryReserve(item.productoId, item.cantidad);
          if (!reservado) {
            const sinStock = new Error(`No hay suficiente stock disponible para reservar (producto ${item.productoId})`);
            sinStock.status = 422;
            sinStock.type = 'REGLA_DE_NEGOCIO';
            throw sinStock;
          }
          aplicadas.push({ atomica: true, productoId: item.productoId, cantidad: item.cantidad });
        }
      } else {
        for (const reserva of reservas) {
          await this.inventarioRepository.save({
            productoId: reserva.productoId,
            ...reserva.actualizado,
          });
          aplicadas.push(reserva);
        }
      }

      const result = await this.ordenRepository.create({
        compradorId: orden.compradorId,
        puntoEntrega: orden.puntoEntrega,
        descuento: orden.descuento,
        estado: orden.estado,
        lineas: orden.lineas,
      });
      await this.carritoRepository.save({
        id: carrito.id, usuarioId, items: carrito.items, estado: 'convertido',
      });
      this.eventBus.publish(EVENTS.ORDER_CREATED, {
        orden: result,
        stockReserved: aplicadas.length > 0,
      });
      return { ...result, total };
    } catch (error) {
      for (const reserva of aplicadas.reverse()) {
        if (reserva.atomica) {
          await this.inventarioRepository.releaseReservation(reserva.productoId, reserva.cantidad);
        } else {
          await this.inventarioRepository.save({
            productoId: reserva.productoId,
            ...reserva.original,
          });
        }
      }
      throw error;
    }
  }
}

module.exports = CrearOrden;
