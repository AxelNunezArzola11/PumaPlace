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

    for (const item of carrito.items) {
      const producto = await this.productoRepository.findById(item.productoId);
      if (!producto) throw new Error(`Producto no encontrado: ${item.productoId}`);
      if (producto.estado && producto.estado !== 'publicado') {
        throw new Error(`El producto ${item.productoId} no está disponible para comprar`);
      }
      orden.agregarLinea(producto.id, item.cantidad, Number(producto.precio));

      if (this.inventarioRepository) {
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
      for (const reserva of reservas) {
        await this.inventarioRepository.save({
          productoId: reserva.productoId,
          ...reserva.actualizado,
        });
        aplicadas.push(reserva);
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
        await this.inventarioRepository.save({
          productoId: reserva.productoId,
          ...reserva.original,
        });
      }
      throw error;
    }
  }
}

module.exports = CrearOrden;
