const mercadopago = require('mercadopago');

class MercadoPagoGateway {
  constructor({ accessToken = process.env.MP_ACCESS_TOKEN, client } = {}) {
    if (!client) {
      if (!accessToken) throw new Error('MP_ACCESS_TOKEN no está configurado');
      const config = new mercadopago.MercadoPagoConfig({ accessToken });
      client = {
        preference: new mercadopago.Preference(config),
        payment: new mercadopago.Payment(config),
      };
    }
    this.client = client;
  }

  async crearPreferencia(orden) {
    if (!orden?.id || !Array.isArray(orden.lineas) || orden.lineas.length === 0) {
      throw new Error('La orden no tiene líneas válidas para crear el pago');
    }
    const subtotal = orden.lineas.reduce(
      (sum, linea) => sum + Math.round(Number(linea.precioUnitario) * 100) * Number(linea.cantidad),
      0,
    );
    const descuento = Math.round(Number(orden.descuento || 0) * 100);
    if (descuento < 0 || descuento > subtotal) {
      throw new Error('El descuento de la orden no es válido');
    }
    const total = (subtotal - descuento) / 100;
    const webhookUrl = process.env.MP_WEBHOOK_URL;
    const backUrls = {
      success: process.env.MP_BACK_URL_SUCCESS,
      failure: process.env.MP_BACK_URL_FAILURE,
      pending: process.env.MP_BACK_URL_PENDING,
    };
    if (!webhookUrl) throw new Error('MP_WEBHOOK_URL debe apuntar a un endpoint público HTTPS');
    if (Object.values(backUrls).some((url) => !url)) {
      throw new Error('MP_BACK_URL_SUCCESS, MP_BACK_URL_FAILURE y MP_BACK_URL_PENDING son obligatorias');
    }
    const response = await this.client.preference.create({
      body: {
        external_reference: String(orden.id),
        notification_url: webhookUrl,
        back_urls: backUrls,
        auto_return: 'approved',
        items: [{
          id: `orden-${orden.id}`,
          title: `Orden Puma Place ${orden.id}`,
          quantity: 1,
          unit_price: total,
          currency_id: 'MXN',
        }],
      },
    });
    return response;
  }

  async consultarPago(id) {
    if (!id) throw new Error('El webhook no contiene el identificador del pago');
    return this.client.payment.get({ id: String(id) });
  }
}

module.exports = MercadoPagoGateway;
