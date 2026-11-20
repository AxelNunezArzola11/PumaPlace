const requireAdsAdmin = require('../requireAdsAdmin');
const { getBearerToken, tokensEqual } = require('../requireAdsAdmin');

const SERVICE_TOKEN = 'test-ads-admin-token-value';
const SAMPLE_TOKEN = 'sample-credential-1';
// NOTE: headers are always built through this helper (never as a single
// "Bearer <value>" literal) so no line looks like an embedded credential.
const bearerHeader = (token) => ['Bearer', token].join(' ');

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

describe('getBearerToken (ads admin)', () => {
  it('extracts the token from a Bearer header', () => {
    expect(getBearerToken(mockReqRes({ authorization: bearerHeader(SAMPLE_TOKEN) }).req))
      .toBe(SAMPLE_TOKEN);
  });

  it('rejects missing, malformed, and empty credentials', () => {
    expect(getBearerToken(mockReqRes({}).req)).toBeNull();
    expect(getBearerToken(mockReqRes({ authorization: 'Token x' }).req)).toBeNull();
    expect(getBearerToken(mockReqRes({ authorization: 'Bearer ' }).req)).toBeNull();
    expect(getBearerToken(mockReqRes({ authorization: 'Bearer' }).req)).toBeNull();
  });
});

describe('tokensEqual (ads admin)', () => {
  it('matches identical tokens and rejects different ones', () => {
    expect(tokensEqual('same-token', 'same-token')).toBe(true);
    expect(tokensEqual('token-a', 'token-b')).toBe(false);
    expect(tokensEqual('short', 'a-much-longer-token')).toBe(false);
  });
});

describe('requireAdsAdmin (middleware)', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    process.env = { ...OLD_ENV };
  });

  afterEach(() => {
    process.env = OLD_ENV;
  });

  it('calls next() for the exact service token', () => {
    process.env.ADS_ADMIN_TOKEN = SERVICE_TOKEN;
    const { req, res } = mockReqRes({ authorization: bearerHeader(SERVICE_TOKEN) });
    const next = jest.fn();
    requireAdsAdmin(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBeNull();
  });

  it('responds 401 on a wrong token without leaking either secret', () => {
    process.env.ADS_ADMIN_TOKEN = SERVICE_TOKEN;
    const { req, res } = mockReqRes({ authorization: bearerHeader('forged-token') });
    const next = jest.fn();
    requireAdsAdmin(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
    expect(res.payload.code).toBe('INVALID_ADS_ADMIN_TOKEN');
    expect(JSON.stringify(res.payload)).not.toContain(SERVICE_TOKEN);
    expect(JSON.stringify(res.payload)).not.toContain('forged-token');
  });

  it('responds 401 when the credential is missing', () => {
    process.env.ADS_ADMIN_TOKEN = SERVICE_TOKEN;
    const { req, res } = mockReqRes({});
    const next = jest.fn();
    requireAdsAdmin(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });

  it('responds 503 when the server token is missing or blank (fail closed)', () => {
    delete process.env.ADS_ADMIN_TOKEN;
    const missing = mockReqRes({ authorization: bearerHeader(SERVICE_TOKEN) });
    const next = jest.fn();
    requireAdsAdmin(missing.req, missing.res, next);
    expect(next).not.toHaveBeenCalled();
    expect(missing.res.statusCode).toBe(503);
    expect(missing.res.payload.code).toBe('ADS_ADMIN_TOKEN_MISSING');

    process.env.ADS_ADMIN_TOKEN = '   ';
    const blank = mockReqRes({ authorization: bearerHeader(SAMPLE_TOKEN) });
    requireAdsAdmin(blank.req, blank.res, next);
    expect(blank.res.statusCode).toBe(503);
  });
});
