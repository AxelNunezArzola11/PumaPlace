const {
  PRODUCTION_FRONTEND_ORIGIN,
  DEV_FRONTEND_ORIGIN,
  ALLOWED_METHODS,
  ALLOWED_HEADERS,
  normalizeOrigin,
  allowedOrigins,
  buildCorsOptions,
} = require('../cors');

function check(options, origin) {
  return new Promise((resolve, reject) => {
    options.origin(origin, (error, allowed) => {
      if (error) reject(error);
      else resolve(allowed);
    });
  });
}

describe('normalizeOrigin', () => {
  it('normalizes URLs with trailing slashes, paths, and mixed case', () => {
    expect(normalizeOrigin('https://puma-place-web.onrender.com/')).toBe('https://puma-place-web.onrender.com');
    expect(normalizeOrigin('HTTPS://Puma-Place-Web.onrender.com/pago/retorno/exito')).toBe('https://puma-place-web.onrender.com');
    expect(normalizeOrigin('http://localhost:4200/')).toBe('http://localhost:4200');
  });

  it('rejects invalid or non-HTTP(S) origins', () => {
    expect(normalizeOrigin('')).toBeNull();
    expect(normalizeOrigin('not-a-url')).toBeNull();
    expect(normalizeOrigin('ftp://example.com')).toBeNull();
  });
});

describe('allowedOrigins', () => {
  it('explicitly allows the production frontend origin alongside configured FRONTEND_URL in production', () => {
    expect(allowedOrigins({
      NODE_ENV: 'production',
      FRONTEND_URL: 'https://puma-place-web.onrender.com/',
    })).toEqual([PRODUCTION_FRONTEND_ORIGIN]);

    expect(allowedOrigins({
      NODE_ENV: 'production',
      FRONTEND_URL: 'https://app.example.test',
    })).toEqual(['https://app.example.test', PRODUCTION_FRONTEND_ORIGIN]);
  });

  it('allows the production frontend origin even if FRONTEND_URL is missing in production', () => {
    expect(allowedOrigins({
      NODE_ENV: 'production',
    })).toEqual([PRODUCTION_FRONTEND_ORIGIN]);
  });

  it('additionally allows the local dev server outside production', () => {
    expect(allowedOrigins({
      NODE_ENV: 'development',
      FRONTEND_URL: 'https://app.example.test',
    })).toEqual(['https://app.example.test', PRODUCTION_FRONTEND_ORIGIN, DEV_FRONTEND_ORIGIN]);
  });

  it('never uses wildcards', () => {
    for (const env of [
      { NODE_ENV: 'production', FRONTEND_URL: 'https://puma-place-web.onrender.com' },
      { NODE_ENV: 'production', FRONTEND_URL: 'https://app.example.test' },
      { NODE_ENV: 'development' },
      {},
    ]) {
      expect(allowedOrigins(env).join(' ')).not.toContain('*');
    }
  });
});

describe('buildCorsOptions', () => {
  it('accepts the production frontend origin even when FRONTEND_URL has a trailing slash', async () => {
    const options = buildCorsOptions({
      NODE_ENV: 'production',
      FRONTEND_URL: 'https://puma-place-web.onrender.com/',
    });
    await expect(check(options, 'https://puma-place-web.onrender.com')).resolves.toBe(true);
  });

  it('accepts the configured frontend origin', async () => {
    const options = buildCorsOptions({
      NODE_ENV: 'production',
      FRONTEND_URL: 'https://app.example.test',
    });
    await expect(check(options, 'https://app.example.test')).resolves.toBe(true);
  });

  it('rejects unknown origins with 403', async () => {
    const options = buildCorsOptions({
      NODE_ENV: 'production',
      FRONTEND_URL: 'https://puma-place-web.onrender.com',
    });
    const error = await check(options, 'https://evil.example').catch((e) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error.status).toBe(403);
  });

  it('allows requests without Origin (curl, Mercado Pago webhooks)', async () => {
    const options = buildCorsOptions({
      NODE_ENV: 'production',
      FRONTEND_URL: 'https://puma-place-web.onrender.com',
    });
    await expect(check(options, undefined)).resolves.toBe(true);
  });

  it('rejects localhost in production even though dev allows it', async () => {
    const options = buildCorsOptions({
      NODE_ENV: 'production',
      FRONTEND_URL: 'https://puma-place-web.onrender.com',
    });
    await expect(check(options, 'http://localhost:4200')).rejects.toThrow();
  });

  it('configures explicit methods, headers, credentials, and 204 preflight status', () => {
    const options = buildCorsOptions({
      NODE_ENV: 'production',
      FRONTEND_URL: 'https://puma-place-web.onrender.com',
    });
    expect(options.methods).toEqual([...ALLOWED_METHODS]);
    expect(options.allowedHeaders).toEqual([...ALLOWED_HEADERS]);
    expect(options.credentials).toBe(true);
    expect(options.optionsSuccessStatus).toBe(204);
  });
});
