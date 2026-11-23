function createAuthController({ registrarUsuario, iniciarSesion }) {
  return {
    register: async (req, res, next) => {
      try {
        const data = await registrarUsuario.execute(req.body);
        return res.status(201).json({ success: true, data, message: 'Usuario registrado' });
      } catch (error) {
        return next(error);
      }
    },
    login: async (req, res, next) => {
      try {
        const data = await iniciarSesion.execute(req.body);
        return res.status(200).json({ success: true, data, message: 'Inicio de sesión exitoso' });
      } catch (error) {
        return next(error);
      }
    },
  };
}

module.exports = createAuthController;
