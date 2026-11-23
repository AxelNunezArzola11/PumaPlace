const jwt = require('jsonwebtoken');
const IniciarSesion = require('../IniciarSesion');
const RegistrarUsuario = require('../RegistrarUsuario');

describe('autenticación', () => {
  it('emite un JWT sin exponer el hash de contraseña', async () => {
    const repository = {
      findByEmail: jest.fn().mockResolvedValue({
        id: 4, correo: 'alumno@unam.mx', edad: 20, rol: 'vendedor', plan: 'premium', passwordHash: 'hash',
      }),
      comparePassword: jest.fn().mockResolvedValue(true),
    };
    const result = await new IniciarSesion({
      usuarioRepository: repository,
      jwtSecret: 'test-secret',
      expiresIn: '1h',
    }).execute({ correo: ' ALUMNO@UNAM.MX ', password: 'correcta' });

    expect(jwt.verify(result.token, 'test-secret')).toEqual(expect.objectContaining({
      sub: 4,
      rol: 'vendedor',
      plan: 'premium',
    }));
    expect(result.usuario).not.toHaveProperty('passwordHash');
    expect(repository.findByEmail).toHaveBeenCalledWith('alumno@unam.mx');
  });

  it('rechaza credenciales inválidas', async () => {
    const useCase = new IniciarSesion({
      usuarioRepository: {
        findByEmail: jest.fn().mockResolvedValue(null),
        comparePassword: jest.fn(),
      },
      jwtSecret: 'test-secret',
    });

    await expect(useCase.execute({ correo: 'no@existe.mx', password: 'incorrecta' }))
      .rejects.toThrow(/credenciales/i);
  });

  it('registra la contraseña a través del repositorio sin devolver datos sensibles', async () => {
    const repository = {
      create: jest.fn().mockResolvedValue({
        id: 1, correo: 'nuevo@unam.mx', edad: 19, rol: 'comprador', plan: 'free', passwordHash: 'hash',
      }),
    };
    const result = await new RegistrarUsuario({ usuarioRepository: repository })
      .execute({ correo: 'nuevo@unam.mx', password: 'una-clave-segura', edad: 19, consentimientoDatos: true });

    expect(result).not.toHaveProperty('passwordHash');
    expect(repository.create).toHaveBeenCalledWith(expect.objectContaining({ password: 'una-clave-segura' }));
  });
});
