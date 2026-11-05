const jwt = require('jsonwebtoken');

function signToken(usuario, options = {}) {
  const secret = options.jwtSecret || process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET no está configurado');
  return jwt.sign(
    { sub: usuario.id, rol: usuario.rol, plan: usuario.plan },
    secret,
    { expiresIn: options.expiresIn || process.env.JWT_EXPIRES_IN || '24h' },
  );
}

function auth(options = {}) {
  const secret = options.jwtSecret || process.env.JWT_SECRET;
  const usuarioRepository = options.usuarioRepository || null;
  if (!secret) throw new Error('JWT_SECRET no está configurado');

  return async (req, res, next) => {
    const header = req.get('authorization');
    if (!header || !header.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'Se requiere autenticación' });
    }
    const token = header.slice(7).trim();
    if (!token) {
      return res.status(401).json({ success: false, message: 'Token inválido' });
    }
    let payload;
    try {
      payload = jwt.verify(token, secret);
    } catch (error) {
      return res.status(401).json({ success: false, message: 'Token inválido o expirado' });
    }

    try {
      // El JWT puede haber sido emitido antes de un cambio de rol o plan
      // (por ejemplo, al convertir una cuenta en vendedor). Consultamos el
      // estado actual para que los permisos no queden desactualizados.
      if (usuarioRepository) {
        const usuario = await usuarioRepository.findById(payload.sub);
        if (!usuario) {
          return res.status(401).json({ success: false, message: 'Usuario no encontrado' });
        }
        req.user = { ...payload, rol: usuario.rol, plan: usuario.plan };
      } else {
        req.user = payload;
      }
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

function requireRole(role) {
  return (req, res, next) => {
    if (!req.user || req.user.rol !== role) {
      return res.status(403).json({ success: false, message: 'No tienes permisos para este recurso' });
    }
    return next();
  };
}

function requirePlan(plan) {
  return (req, res, next) => {
    if (!req.user || req.user.plan !== plan) {
      return res.status(403).json({ success: false, message: 'Tu plan no permite este recurso' });
    }
    return next();
  };
}

module.exports = { auth, requireRole, requirePlan, signToken };
