const MAX_NOMBRE = 150;

function validateProduct({ requireStock = false } = {}) {
  return (req, res, next) => {
    const { nombre, precio, cantidadDisponible } = req.body;

    if (nombre !== undefined) {
      const value = typeof nombre === 'string' ? nombre.trim() : '';
      if (!value) {
        return res.status(400).json({ success: false, message: 'El nombre del producto es obligatorio' });
      }
      if (value.length > MAX_NOMBRE) {
        return res.status(400).json({
          success: false,
          message: `El nombre del producto no puede superar ${MAX_NOMBRE} caracteres`,
        });
      }
    }

    if (precio !== undefined) {
      const value = Number(precio);
      if (!Number.isFinite(value) || value <= 0) {
        return res.status(400).json({ success: false, message: 'El precio debe ser mayor a 0' });
      }
    }

    if (cantidadDisponible !== undefined || requireStock) {
      const value = Number(cantidadDisponible);
      const minimo = requireStock ? 1 : 0;
      if (!Number.isSafeInteger(value) || value < minimo) {
        return res.status(400).json({
          success: false,
          message: requireStock
            ? 'El producto debe tener al menos 1 unidad en stock'
            : 'El stock debe ser un entero mayor o igual a 0',
        });
      }
    }

    return next();
  };
}

module.exports = validateProduct;
