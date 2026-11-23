function validateBody(requiredFields) {
  return (req, res, next) => {
    const missing = requiredFields.filter((field) => {
      const value = req.body[field];
      return value === undefined || value === null || value === '';
    });
    if (missing.length) {
      return res.status(400).json({
        success: false,
        message: `Faltan campos obligatorios: ${missing.join(', ')}`,
      });
    }
    return next();
  };
}

module.exports = validateBody;
