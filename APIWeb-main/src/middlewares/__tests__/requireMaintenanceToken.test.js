const requireMaintenanceToken = require('../requireMaintenanceToken');
const { getBearerToken, tokensEqual } = require('../requireMaintenanceToken');

const SERVICE_TOKEN = 'test-maintenance-token-value';

function mockReqRes({ authorization, useGet = true } = {}) {
  const headers = authorization !== undefined ? { authorization } : {};
  const req = useGet
    ? { headers, get: (name) => headers[name.toLowerCase()] ?? undefined }
    : { headers };
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

describe('getBearerToken', () => {
  it('extracts the token from a Bearer header', () => {
    expect(getBearerToken(mockReqRes({ authorization: 'Bearer abc123' }).req)).toBe('abc123');
  });

  it('accepts the scheme case-insensitively', () => {
    expect(getBearerToken(mockReqRes({ authorization: 'bearer abc123' }).req)).toBe('abc123');
  });

  it('rejects missing, malformed, and empty credentials', () => {
    expect(getBearerToken(mockReqRes({}).req)).toBeNull();
    expect(getBearerToken(mockReqRes({ authorization: 'Token abc123' }).req)).toBeNull();
    expect(getBearerToken(mockReqRes({ authorization: 'Bearer ' }).req)).toBeNull();
    expect(getBearerToken(mockReqRes({ authorization: 'Bearer' }).req)).toBeNull();
  });

  it('reads plain headers when req.get is unavailable', () => {
    expect(getBearerToken(mockReqRes({ authorization: 'Bearer abc123', useGet: false }).req)).toBe('abc123');
  });
});

describe('tokensEqual', () => {
  it('matches identical tokens and rejects different ones', () => {
    expect(tokensEqual('same-token', 'same-token')).toBe(true);
    expect(tokensEqual('token-a', 'token-b')).toBe(false);
    expect(tokensEqual('short', 'a-much-longer-token')).toBe(false);
  });
});

describe('requireMaintenanceToken (middleware)', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    process.env = { ...OLD_ENV };
  });

  afterEach(() => {
    process.env = OLD_ENV;
  });

  it('calls next() for the exact service token', () => {
    process.env.MAINTENANCE_TOKEN = SERVICE_TOKEN;
    const { req, res } = mockReqRes({ authorization: `Bearer ${SERVICE_TOKEN}` });
    const next = jest.fn();
    requireMaintenanceToken(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBeNull();
  });

  it('responds 401 on a wrong token without leaking either secret', () => {
    process.env.MAINTENANCE_TOKEN = SERVICE_TOKEN;
    const { req, res } = mockReqRes({ authorization: 'Bearer forged-token' });
    const next = jest.fn();
    requireMaintenanceToken(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
    expect(res.payload.code).toBe('INVALID_MAINTENANCE_TOKEN');
    expect(JSON.stringify(res.payload)).not.toContain(SERVICE_TOKEN);
    expect(JSON.stringify(res.payload)).not.toContain('forged-token');
  });

  it('responds 401 when the credential is missing', () => {
    process.env.MAINTENANCE_TOKEN = SERVICE_TOKEN;
    const { req, res } = mockReqRes({});
    const next = jest.fn();
    requireMaintenanceToken(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });

  it('responds 503 when the server token is missing (fail closed)', () => {
    delete process.env.MAINTENANCE_TOKEN;
    const { req, res } = mockReqRes({ authorization: `Bearer ${SERVICE_TOKEN}` });
    const next = jest.fn();
    requireMaintenanceToken(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(503);
    expect(res.payload.code).toBe('MAINTENANCE_TOKEN_MISSING');
  });

  it('responds 503 when the server token is blank (fail closed)', () => {
    process.env.MAINTENANCE_TOKEN = '   ';
    const { req, res } = mockReqRes({ authorization: 'Bearer anything' });
    const next = jest.fn();
    requireMaintenanceToken(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(503);
  });
});
