/**
 * Entidad de dominio pura: Notificacion.
 * El "enviar" real (email/push) vive en infraestructura; aquí solo
 * se modela el dato y la regla de qué tipos existen.
 */
const TIPOS_VALIDOS = ['carrito_abandonado', 'reabastecimiento', 'inactividad', 'otro'];

class Notificacion {
  constructor({ id = null, usuarioId, tipo, mensaje, fecha = new Date(), enviada = false }) {
    if (!usuarioId) {
      throw new Error('La notificación requiere un usuarioId');
    }
    if (!TIPOS_VALIDOS.includes(tipo)) {
      throw new Error(`Tipo de notificación inválido: ${tipo}`);
    }
    this.id = id;
    this.usuarioId = usuarioId;
    this.tipo = tipo;
    this.mensaje = mensaje;
    this.fecha = fecha;
    this.enviada = enviada;
  }

  marcarEnviada() {
    this.enviada = true;
  }
}

module.exports = Notificacion;