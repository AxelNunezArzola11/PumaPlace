const pick = (body, fields) => Object.fromEntries(
  fields.filter((field) => body[field] !== undefined).map((field) => [field, body[field]]),
);

function createResourceController({
  repository, createUseCase, createFields = [], updateFields = [], serialize = (data) => data,
}) {
  return {
    list: async (req, res, next) => {
      try {
        const data = await repository.findAll();
        return res.json({ success: true, data: serialize(data), message: 'Consulta exitosa' });
      } catch (error) {
        return next(error);
      }
    },
    get: async (req, res, next) => {
      try {
        const data = await repository.findById(req.params.id);
        if (!data) return res.status(404).json({ success: false, message: 'Recurso no encontrado' });
        return res.json({ success: true, data: serialize(data), message: 'Consulta exitosa' });
      } catch (error) {
        return next(error);
      }
    },
    create: async (req, res, next) => {
      try {
        const data = createUseCase
          ? await createUseCase.execute(req.body, req)
          : await repository.create(pick(req.body, createFields));
        return res.status(201).json({ success: true, data: serialize(data), message: 'Recurso creado' });
      } catch (error) {
        return next(error);
      }
    },
    update: async (req, res, next) => {
      try {
        const data = await repository.updateById(req.params.id, pick(req.body, updateFields));
        if (!data) return res.status(404).json({ success: false, message: 'Recurso no encontrado' });
        return res.json({ success: true, data: serialize(data), message: 'Recurso actualizado' });
      } catch (error) {
        return next(error);
      }
    },
    remove: async (req, res, next) => {
      try {
        const deleted = await repository.deleteById(req.params.id);
        if (!deleted) return res.status(404).json({ success: false, message: 'Recurso no encontrado' });
        return res.status(204).send();
      } catch (error) {
        return next(error);
      }
    },
  };
}

module.exports = { createResourceController, pick };
