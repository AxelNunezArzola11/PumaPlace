const MercadoPagoGateway = require('../MercadoPagoGateway');

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
