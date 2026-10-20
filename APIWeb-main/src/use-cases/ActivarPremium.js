const { EVENTS } = require('../domain/events/EventBus');

class ActivarPremium {
  constructor({ usuarioRepository, suscripcionRepository, eventBus, duracionDias = 30 } = {}) {
    if (!usuarioRepository || !suscripcionRepository || !eventBus) {
      throw new Error('ActivarPremium requiere repositorios y EventBus');
    }
    this.usuarioRepository = usuarioRepository;
    this.suscripcionRepository = suscripcionRepository;
    this.eventBus = eventBus;
    this.duracionDias = duracionDias;
  }

  async execute(usuarioId) {
    const usuario = await this.usuarioRepository.findById(usuarioId);
    if (!usuario) throw new Error('Usuario no encontrado');
    const active = await this.suscripcionRepository.findActiveByUsuarioId(usuarioId);
    if (active) throw new Error('El usuario ya tiene una suscripción activa');
    const fechaInicio = new Date();
    const fechaFin = new Date(fechaInicio);
    fechaFin.setDate(fechaFin.getDate() + this.duracionDias);
    const subscription = await this.suscripcionRepository.create({
      usuarioId,
      plan: 'premium',
      estado: 'activa',
      fechaInicio,
      fechaFin,
    });
    await this.usuarioRepository.updateById(usuarioId, { plan: 'premium' });
    this.eventBus.publish(EVENTS.SUBSCRIPTION_UPGRADED, { usuarioId, suscripcion: subscription });
    return subscription;
  }
}

module.exports = ActivarPremium;
