function createBusinessController({ useCase, mapBody = (body) => body, status = 200, message = 'Operación exitosa' }) {
  return async (req, res, next) => {
    try {
      const data = await useCase.execute(mapBody(req));
      return res.status(status).json({ success: true, data, message });
    } catch (error) {
      return next(error);
    }
  };
}

module.exports = createBusinessController;
