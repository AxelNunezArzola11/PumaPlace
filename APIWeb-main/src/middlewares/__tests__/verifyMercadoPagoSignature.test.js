const verifyMercadoPagoSignature = require('../verifyMercadoPagoSignature');
const {
  verifySignature,
  buildManifest,
  signManifest,
} = require('../verifyMercadoPagoSignature');

const SECRET = 'test-webhook-secret-value';

function signedHeaders({ dataId = 'pay-123', requestId = 'req-abc', ts = null, secret = SECRET } = {}) {
  const timestamp = ts !== null ? ts : String(Math.floor(Date.now() / 1000));
  const manifest = buildManifest({ dataId, requestId, ts: timestamp });
  return {
    'x-request-id': requestId,
    'x-signature': `ts=${timestamp},v1=${signManifest(manifest, secret)}`,
  };
}

function mockReqRes({ headers = {}, body = { data: { id: 'pay-123' } }, query = {} } = {}) {
  const req = { headers, body, query };
  const res = {
    statusCode: null,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
  };
  return { req, res };
}

describe('verifySignature (pure)', () => {
  it('accepts a correctly signed notification', () => {
    const headers = signedHeaders({});
    const parsed = Object.fromEntries(headers['x-signature'].split(',').map((c) => c.split('=')));
    expect(verifySignature({
      dataId: 'pay-123',
      requestId: headers['x-request-id'],
      signatureHeader: headers['x-signature'],
      secret: SECRET,
      now: Number(parsed.ts) * 1000,
    })).toEqual({ ok: true, reason: 'verified' });
  });

  it('rejects tampered payment ids', () => {
    const headers = signedHeaders({ dataId: 'pay-123' });
    const result = verifySignature({
      dataId: 'pay-999',
      requestId: headers['x-request-id'],
      signatureHeader: headers['x-signature'],
      secret: SECRET,
    });
    expect(result).toEqual({ ok: false, reason: 'invalid-signature' });
  });

  it('rejects wrong secrets', () => {
    const headers = signedHeaders({ secret: 'other-secret' });
    expect(verifySignature({
      dataId: 'pay-123',
      requestId: headers['x-request-id'],
      signatureHeader: headers['x-signature'],
      secret: SECRET,
    }).ok).toBe(false);
  });

  it('rejects stale timestamps outside the freshness window', () => {
    const oldTs = String(Math.floor(Date.now() / 1000) - 3600);
    const headers = signedHeaders({ ts: oldTs });
    expect(verifySignature({
      dataId: 'pay-123',
      requestId: headers['x-request-id'],
      signatureHeader: headers['x-signature'],
      secret: SECRET,
    })).toEqual({ ok: false, reason: 'stale-signature' });
  });

  it('rejects malformed signature headers', () => {
    expect(verifySignature({
      dataId: 'pay-123',
      requestId: 'req-abc',
      signatureHeader: 'not-a-signature',
      secret: SECRET,
    })).toEqual({ ok: false, reason: 'malformed-signature' });
  });
});

describe('verifyMercadoPagoSignature (middleware)', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    process.env = { ...OLD_ENV };
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = OLD_ENV;
    jest.restoreAllMocks();
  });

  it('calls next() on a valid signature', () => {
    process.env.MP_WEBHOOK_SECRET = SECRET;
    const { req, res } = mockReqRes({ headers: signedHeaders({}) });
    const next = jest.fn();
    verifyMercadoPagoSignature(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBeNull();
  });

  it('responds 401 and never calls next() on an invalid signature', () => {
    process.env.MP_WEBHOOK_SECRET = SECRET;
    const headers = signedHeaders({});
    headers['x-signature'] = `${headers['x-signature']}tampered`;
    const { req, res } = mockReqRes({ headers });
    const next = jest.fn();
    verifyMercadoPagoSignature(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
    expect(res.payload.code).toBe('INVALID_WEBHOOK_SIGNATURE');
  });

  it('responds 503 in production when the secret is missing (fail closed)', () => {
    delete process.env.MP_WEBHOOK_SECRET;
    process.env.NODE_ENV = 'production';
    const { req, res } = mockReqRes();
    const next = jest.fn();
    verifyMercadoPagoSignature(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(503);
    expect(res.payload.code).toBe('WEBHOOK_SECRET_MISSING');
  });

  it('allows unsigned requests in development with a warning', () => {
    delete process.env.MP_WEBHOOK_SECRET;
    process.env.NODE_ENV = 'development';
    const { req, res } = mockReqRes();
    const next = jest.fn();
    verifyMercadoPagoSignature(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBeNull();
    expect(console.warn).toHaveBeenCalled();
  });
});
