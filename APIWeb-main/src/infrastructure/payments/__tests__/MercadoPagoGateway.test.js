const MercadoPagoGateway = require('../MercadoPagoGateway');
const { selectCheckoutUrl } = require('../MercadoPagoGateway');

describe('MercadoPagoGateway', () => {
  const orden = { id: 7, lineas: [{ precioUnitario: 25, cantidad: 2 }], descuento: 0 };

  beforeEach(() => {
    process.env.MP_WEBHOOK_URL = 'https://example.test/api/pagos/webhook';
    process.env.MP_BACK_URL_SUCCESS = 'https://example.test/ok';
    process.env.MP_BACK_URL_FAILURE = 'https://example.test/fail';
    process.env.MP_BACK_URL_PENDING = 'https://example.test/pending';
  });

  it('fails clearly when a public webhook or return URL is missing', async () => {
    delete process.env.MP_WEBHOOK_URL;
    const gateway = new MercadoPagoGateway({
      client: { preference: { create: jest.fn() } },
    });
    await expect(gateway.crearPreferencia(orden)).rejects.toThrow(/MP_WEBHOOK_URL/i);
  });

  it('omits payer from the preference payload (buyer authenticates at checkout)', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'pref-1' });
    const gateway = new MercadoPagoGateway({ client: { preference: { create } } });
    await gateway.crearPreferencia(orden);
    expect(create.mock.calls[0][0].body).not.toHaveProperty('payer');
  });

  it('sends backend total, notification URL and return URLs to Mercado Pago', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'pref-1', sandbox_init_point: 'https://checkout.test' });
    const gateway = new MercadoPagoGateway({ client: { preference: { create } } });
    await gateway.crearPreferencia(orden);
    expect(create).toHaveBeenCalledWith({
      body: expect.objectContaining({
        notification_url: process.env.MP_WEBHOOK_URL,
        back_urls: {
          success: process.env.MP_BACK_URL_SUCCESS,
          failure: process.env.MP_BACK_URL_FAILURE,
          pending: process.env.MP_BACK_URL_PENDING,
        },
        items: [expect.objectContaining({ unit_price: 50 })],
      }),
    });
  });
});

describe('selectCheckoutUrl', () => {
  const preference = {
    id: 'pref-1',
    sandbox_init_point: 'https://sandbox.mercadopago.com/checkout/pay?pref_id=pref-1',
    init_point: 'https://www.mercadopago.com.mx/checkout/start?pref_id=pref-1',
  };

  it('selects sandbox_init_point for TEST credentials', () => {
    expect(selectCheckoutUrl(preference, 'TEST-123')).toBe(preference.sandbox_init_point);
  });

  it('selects init_point for APP_USR test-user credentials', () => {
    expect(selectCheckoutUrl(preference, 'APP_USR-123')).toBe(preference.init_point);
  });

  it('fails closed when the TEST sandbox URL is missing', () => {
    expect(() => selectCheckoutUrl({ init_point: preference.init_point }, 'TEST-123'))
      .toThrow(/sandbox_init_point/);
  });

  it('fails closed when the APP_USR checkout URL is missing', () => {
    expect(() => selectCheckoutUrl({ sandbox_init_point: preference.sandbox_init_point }, 'APP_USR-123'))
      .toThrow(/init_point/);
  });

  it('fails closed on unknown or missing token prefixes', () => {
    expect(() => selectCheckoutUrl(preference, 'BEARER-123')).toThrow(/prefijo/);
    expect(() => selectCheckoutUrl(preference, '')).toThrow(/no está configurado/);
    expect(() => selectCheckoutUrl(preference, null)).toThrow(/no está configurado/);
  });
});
