const jwt = require('jsonwebtoken');
const { auth, requireRole, requirePlan } = require('../auth');

const response = () => ({
  status: jest.fn().mockReturnThis(),
  json: jest.fn().mockReturnThis(),
});

describe('middleware de autorización', () => {
  it('rechaza solicitudes sin bearer token', () => {
    const res = response();
    auth({ jwtSecret: 'test-secret' })({ get: () => undefined }, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('adjunta el usuario al validar un JWT', () => {
    const req = {
      get: () => `Bearer ${jwt.sign({ sub: 1, rol: 'vendedor', plan: 'premium' }, 'test-secret')}`,
    };
    const next = jest.fn();
    auth({ jwtSecret: 'test-secret' })(req, response(), next);
    expect(next).toHaveBeenCalled();
    expect(req.user).toEqual(expect.objectContaining({ sub: 1 }));
  });

  it('actualiza el rol desde la base de datos aunque el token esté desactualizado', async () => {
    const req = {
      get: () => `Bearer ${jwt.sign({ sub: 1, rol: 'comprador', plan: 'free' }, 'test-secret')}`,
    };
    const next = jest.fn();
    const usuarioRepository = {
      findById: jest.fn().mockResolvedValue({ id: 1, rol: 'vendedor', plan: 'premium' }),
    };

    await auth({ jwtSecret: 'test-secret', usuarioRepository })(req, response(), next);

    expect(next).toHaveBeenCalled();
    expect(req.user).toEqual(expect.objectContaining({ rol: 'vendedor', plan: 'premium' }));
  });

  it('aplica guards de rol y plan', () => {
    const next = jest.fn();
    const req = { user: { rol: 'vendedor', plan: 'premium' } };
    requireRole('vendedor')(req, response(), next);
    requirePlan('premium')(req, response(), next);
    expect(next).toHaveBeenCalledTimes(2);

    const res = response();
    requireRole('vendedor')({ user: { rol: 'comprador' } }, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(403);
  });
});
