const { EVENTS } = require('../domain/events/EventBus');

// Fallback only: routes pass the authoritative TTL (RESERVATION_TTL_MS).
const DEFAULT_TTL_MS = 30 * 60 * 1000;

/**
 * Expira reservas abandonadas: cancela órdenes pendiente/procesando más
 * viejas que el TTL y libera su inventario.
 *
 * Safety properties (no schema change):
 * - Each candidate is re-validated (open estado + older than cutoff) before
 *   the claim, so a stale read can never cancel a paid order.
 * - The state transition is an atomic conditional UPDATE (cancelIfOpen):
 *   exactly one concurrent claimer wins per order, and only the winner
 *   releases the reservation — the same stock can never be released twice.
 * - Release is tolerant (already-released lines are a no-op) and a single
 *   poison order never aborts the batch: failures are collected in `fallos`.
 * - Events publish AFTER the claim+release, so a failed publication can
 *   never leave inventory reserved (the stock was already freed).
 */
class ExpirarReservasVencidas {
  constructor({
    ordenRepository, inventarioRepository, eventBus,
    ttlMs = DEFAULT_TTL_MS, now = () => Date.now(), batchLimit = 100,
  } = {}) {
    if (!ordenRepository || !inventarioRepository || !eventBus) {
      throw new Error('ExpirarReservasVencidas requiere repositorios y EventBus');
    }
    this.ordenRepository = ordenRepository;
    this.inventarioRepository = inventarioRepository;
    this.eventBus = eventBus;
    this.ttlMs = ttlMs;
    this.now = now;
    this.batchLimit = batchLimit;
  }

  async execute() {
    const cutoff = new Date(this.now() - this.ttlMs);
    const candidates = await this.ordenRepository.findExpirableCandidates(cutoff, this.batchLimit);
    const ids = [];
    const fallos = [];
    for (const orden of candidates || []) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const expirada = await this.expirarOrden(orden, cutoff);
        if (expirada) ids.push(orden.id);
      } catch (error) {
        fallos.push({ ordenId: orden?.id ?? null, message: error.message });
      }
    }
    return { expiradas: ids.length, ids, fallos };
  }

  async expirarOrden(orden, cutoff) {
    if (!orden || !['pendiente', 'procesando'].includes(orden.estado)) return false;
    const created = orden.createdAt ? new Date(orden.createdAt).getTime() : NaN;
    if (!Number.isFinite(created) || created >= cutoff.getTime()) return false;
    const claimed = await this.ordenRepository.cancelIfOpen(orden.id);
    if (!claimed) return false;
    for (const linea of orden.lineas || []) {
      const cantidad = Number(linea?.cantidad);
      if (!Number.isSafeInteger(cantidad) || cantidad <= 0) continue;
      try {
        // eslint-disable-next-line no-await-in-loop
        await this.inventarioRepository.releaseReservation(linea.productoId, cantidad);
      } catch (error) {
        // One bad line must not block the rest of the batch; the order is
        // already cancelled (audit-safe) and the failure is reported.
        throw new Error(`No se pudo liberar el producto ${linea.productoId} de la orden ${orden.id}: ${error.message}`);
      }
    }
    const cancelada = { ...orden, estado: 'cancelada' };
    try {
      this.eventBus.publish(EVENTS.ORDER_CANCELLED, { orden: cancelada, stockReleased: true });
    } catch (error) {
      throw new Error(`Orden ${orden.id} cancelada pero el evento falló: ${error.message}`);
    }
    return true;
  }
}

module.exports = ExpirarReservasVencidas;
module.exports.DEFAULT_TTL_MS = DEFAULT_TTL_MS;
