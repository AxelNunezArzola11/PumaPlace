const { allowedOrigins, buildCorsOptions } = require('../cors');

function check(options, origin) {
  return new Promise((resolve, reject) => {
    options.origin(origin, (error, allowed) => {
      if (error) reject(error);
      else resolve(allowed);
    });
  });
}

describe('allowedOrigins', () => {
  it('allows ONLY the configured frontend in production', () => {
    expect(allowedOrigins({
      NODE_ENV: 'production',
      FRONTEND_URL: 'https://app.example.test',
    })).toEqual(['https://app.example.test']);
  });

  it('additionally allows the local dev server outside production', () => {
    expect(allowedOrigins({
      NODE_ENV: 'development',
      FRONTEND_URL: 'https://app.example.test',
    })).toEqual(['https://app.example.test', 'http://localhost:4200']);
  });

  it('never uses wildcards', () => {
    for (const env of [
      { NODE_ENV: 'production', FRONTEND_URL: 'https://app.example.test' },
      { NODE_ENV: 'development' },
      {},
    ]) {
      expect(allowedOrigins(env).join(' ')).not.toContain('*');
    }
  });
});

describe('buildCorsOptions', () => {
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
      FRONTEND_URL: 'https://app.example.test',
    });
    const error = await check(options, 'https://evil.example').catch((e) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error.status).toBe(403);
  });

  it('allows requests without Origin (curl, Mercado Pago webhooks)', async () => {
    const options = buildCorsOptions({
      NODE_ENV: 'production',
      FRONTEND_URL: 'https://app.example.test',
    });
    await expect(check(options, undefined)).resolves.toBe(true);
  });

  it('rejects localhost in production even though dev allows it', async () => {
    const options = buildCorsOptions({
      NODE_ENV: 'production',
      FRONTEND_URL: 'https://app.example.test',
    });
    await expect(check(options, 'http://localhost:4200')).rejects.toThrow();
  });
});
