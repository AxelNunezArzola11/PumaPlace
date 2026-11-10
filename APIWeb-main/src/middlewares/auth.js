const jwt = require('jsonwebtoken');

function auth(options = {}) {
  const secret = options.jwtSecret || process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET no está configurado');

  return (req, res, next) => {
    const header = req.get('authorization');
    if (!header || !header.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'Se requiere autenticación' });
    }
    const token = header.slice(7).trim();
    if (!token) {
      return res.status(401).json({ success: false, message: 'Token inválido' });
    }
    try {
      req.user = jwt.verify(token, secret);
      return next();
    } catch (error) {
      return res.status(401).json({ success: false, message: 'Token inválido o expirado' });
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

module.exports = { auth, requireRole, requirePlan };
