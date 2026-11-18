const {
  validateEnv,
  assertEnv,
  getConfig,
  parseBoolean,
  isBase64Key32Bytes,
} = require('../env');

const KEY_32 = Buffer.alloc(32, 7).toString('base64');

// Minimal valid development environment (names only; values are fake).
function devEnv(overrides = {}) {
  return {
    NODE_ENV: 'development',
    DB_HOST: 'localhost',
    DB_PORT: '3306',
    DB_USER: 'root',
    DB_PASSWORD: 'local-dev-password',
    DB_NAME: 'mydb',
    JWT_SECRET: 'local-dev-jwt-secret-value',
    ENCRYPTION_KEY: KEY_32,
    INDEX_KEY: KEY_32,
    MP_ACCESS_TOKEN: 'TEST-fake-access-token',
    MP_WEBHOOK_URL: 'https://example.test/api/pagos/webhook',
    ...overrides,
  };
}

function prodEnv(overrides = {}) {
  return {
    ...devEnv(),
    NODE_ENV: 'production',
    MP_BACK_URL_SUCCESS: 'https://app.example.test/pago/retorno/exito',
    MP_BACK_URL_FAILURE: 'https://app.example.test/pago/retorno/fallo',
    MP_BACK_URL_PENDING: 'https://app.example.test/pago/retorno/pendiente',
    FRONTEND_URL: 'https://app.example.test',
    JWT_EXPIRES_IN: '24h',
    DB_SSL: 'true',
    PORT: '10000',
    ...overrides,
  };
}

describe('validateEnv', () => {
  it('accepts a complete development environment', () => {
    expect(validateEnv(devEnv())).toEqual({ ok: true, missing: [], errors: [] });
  });

  it('accepts a complete production environment', () => {
    expect(validateEnv(prodEnv())).toEqual({ ok: true, missing: [], errors: [] });
  });

  it('reports every missing variable NAME without exposing values', () => {
    const env = devEnv({ DB_PASSWORD: '', JWT_SECRET: undefined });
    const result = validateEnv(env);
    expect(result.ok).toBe(false);
    expect(result.missing).toEqual(
      expect.arrayContaining(['DB_PASSWORD', 'JWT_SECRET']),
    );
    expect(JSON.stringify(result)).not.toContain('local-dev');
  });

  it('requires back URLs, FRONTEND_URL and TLS settings in production', () => {
    const env = prodEnv({
      MP_BACK_URL_SUCCESS: '',
      FRONTEND_URL: '',
      DB_SSL: '',
      PORT: '',
    });
    const result = validateEnv(env);
    expect(result.ok).toBe(false);
    expect(result.missing).toEqual(
      expect.arrayContaining(['MP_BACK_URL_SUCCESS', 'FRONTEND_URL', 'DB_SSL', 'PORT']),
    );
  });

  it('rejects DB_SSL=false in production because TiDB Cloud requires TLS', () => {
    const result = validateEnv(prodEnv({ DB_SSL: 'false' }));
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toMatch(/TLS/);
  });

  it('rejects non-numeric ports', () => {
    expect(validateEnv(devEnv({ DB_PORT: 'abc' })).ok).toBe(false);
    expect(validateEnv(prodEnv({ PORT: '99999' })).ok).toBe(false);
  });

  it('rejects malformed 32-byte keys', () => {
    expect(validateEnv(devEnv({ ENCRYPTION_KEY: 'not-base64!!' })).ok).toBe(false);
    expect(validateEnv(devEnv({ INDEX_KEY: Buffer.alloc(16).toString('base64') })).ok).toBe(false);
  });

  it('requires a public HTTPS webhook URL in production', () => {
    const result = validateEnv(prodEnv({ MP_WEBHOOK_URL: 'http://internal/webhook' }));
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toMatch(/MP_WEBHOOK_URL/);
  });

  it('rejects placeholder secrets in production', () => {
    const result = validateEnv(prodEnv({ JWT_SECRET: 'changeme' }));
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toMatch(/JWT_SECRET/);
  });
});

describe('assertEnv', () => {
  it('throws a single error listing missing NAMES only', () => {
    expect(() => assertEnv(devEnv({ DB_NAME: '' }))).toThrow(/DB_NAME/);
    try {
      assertEnv(devEnv({ DB_NAME: '' }));
      throw new Error('should have thrown');
    } catch (error) {
      expect(error.code).toBe('ENV_VALIDATION_FAILED');
      expect(error.message).not.toContain('mydb');
    }
  });
});

describe('getConfig', () => {
  it('applies safe dev back-URL defaults so the legacy local .env keeps working', () => {
    const config = getConfig(devEnv());
    expect(config.mercadoPago.backUrls.success).toBe('http://localhost:4200/pago/retorno/exito');
    expect(config.isProduction).toBe(false);
    expect(config.db.ssl).toBe(false);
  });

  it('never defaults required production values', () => {
    const config = getConfig(prodEnv({ MP_BACK_URL_SUCCESS: undefined }));
    expect(config.mercadoPago.backUrls.success).toBeUndefined();
    expect(config.isProduction).toBe(true);
    expect(config.db.ssl).toBe(true);
  });
});

describe('helpers', () => {
  it('parses booleans defensively', () => {
    expect(parseBoolean('true')).toBe(true);
    expect(parseBoolean(' FALSE ')).toBe(false);
    expect(parseBoolean('', true)).toBe(true);
    expect(parseBoolean(undefined)).toBe(false);
  });

  it('validates base64 32-byte keys', () => {
    expect(isBase64Key32Bytes(KEY_32)).toBe(true);
    expect(isBase64Key32Bytes('short')).toBe(false);
  });
});
