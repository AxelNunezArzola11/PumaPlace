const mercadopago = require('mercadopago');

/**
 * Selects the buyer-facing Checkout Pro URL matching the credential model.
 *
 * - TEST-* access token  → `sandbox_init_point` REQUIRED. A legacy-sandbox
 *   credential must never land on the production checkout.
 * - APP_USR-* access token → `init_point`. Test-user credentials operate on
 *   Mercado Pago's current rails, where the legacy sandbox host rejects the
 *   preference (/fatal/); with a test-user collector no real money can move.
 *
 * WARNING: an APP_USR token from a REAL account would open the production
 * checkout. The deployment MUST use the sandbox test seller's credential;
 * Puma Place cannot distinguish test-user from real APP_USR tokens offline.
 * Unknown or missing tokens fail closed (never guess a URL).
 */
function selectCheckoutUrl(preference, accessToken) {
  const token = accessToken == null ? '' : String(accessToken).trim();
  if (token === '') throw new Error('MP_ACCESS_TOKEN no está configurado');
  if (token.startsWith('TEST-')) {
    const url = preference?.sandbox_init_point;
    if (!url) throw new Error('Mercado Pago no devolvió una URL de pruebas (sandbox_init_point)');
    return url;
  }
  if (token.startsWith('APP_USR-')) {
    const url = preference?.init_point;
    if (!url) throw new Error('Mercado Pago no devolvió una URL de checkout (init_point)');
    return url;
  }
  throw new Error('MP_ACCESS_TOKEN tiene un prefijo no reconocido; se esperaba TEST- o APP_USR-');
}

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
module.exports.selectCheckoutUrl = selectCheckoutUrl;
