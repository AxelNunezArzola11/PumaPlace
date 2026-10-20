process.env.JWT_SECRET = 'integration-test-secret';
process.env.DB_HOST = process.env.DB_HOST || 'localhost';
process.env.DB_USER = process.env.DB_USER || 'test';
process.env.DB_PASSWORD = process.env.DB_PASSWORD || 'test';
process.env.DB_NAME = process.env.DB_NAME || 'test';

const request = require('supertest');
const { app } = require('../../index');

describe('API integration', () => {
  it('exposes the health endpoint with the standard status payload', async () => {
    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });

  it('serves the OpenAPI documentation', async () => {
    const response = await request(app).get('/api-docs/');

    expect(response.status).toBe(200);
    expect(response.text).toContain('Swagger UI');
  });

  it('requires authentication on protected resources', async () => {
    const response = await request(app)
      .post('/api/productos')
      .send({ categoriaId: 1, nombre: 'Producto', descripcion: 'Descripción', precio: 10 });

    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({
      success: false,
      message: 'Se requiere autenticación',
    });
  });

  it('rejects registration without data-processing consent before persistence', async () => {
    const response = await request(app)
      .post('/api/auth/register')
      .send({
        correo: 'integration@unam.mx',
        password: 'Password123!',
        edad: 20,
        consentimientoDatos: false,
      });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      success: false,
      message: 'Se requiere consentimiento para el tratamiento de datos',
    });
  });
});
