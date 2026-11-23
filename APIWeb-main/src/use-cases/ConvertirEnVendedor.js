const { z } = require('zod');
const { cifrar } = require('../infrastructure/crypto/cifrado');

const datosVendedorSchema = z.object({
  nombreCompleto: z.string().trim().min(3).max(150),
  telefono: z.string().trim().regex(/^\+?[0-9]{10,15}$/),
  numeroCuenta: z.string().trim().regex(/^[0-9]{6,12}$/),
  datosPago: z.string().trim().min(5).max(255),
  consentimientoDatos: z.literal(true),
});

class ConvertirEnVendedor {
  constructor({ usuarioRepository } = {}) {
    if (!usuarioRepository) throw new Error('ConvertirEnVendedor requiere un repositorio');
    this.usuarioRepository = usuarioRepository;
  }

  async execute(usuarioId, datos) {
    const usuario = await this.usuarioRepository.findById(usuarioId);
    if (!usuario) throw new Error('Usuario no encontrado');
    if (datos === undefined) {
      return this.usuarioRepository.updateById(usuarioId, { rol: 'vendedor' });
    }
    const parsed = datosVendedorSchema.safeParse(datos);
    if (!parsed.success) {
      const error = new Error('Los datos para vender no son válidos');
      error.status = 422;
      error.type = 'VALIDATION';
      error.invalid_params = parsed.error.issues.map((issue) => ({
        name: issue.path.join('.'),
        reason: issue.message,
      }));
      throw error;
    }
    return this.usuarioRepository.updateById(usuarioId, {
      rol: 'dual',
      nombreCompleto: parsed.data.nombreCompleto,
      telefono: parsed.data.telefono,
      numeroCuenta: cifrar(parsed.data.numeroCuenta),
      datosPagoCifrados: cifrar(parsed.data.datosPago),
      consentimientoDatos: true,
    });
  }
}

module.exports = ConvertirEnVendedor;
module.exports.datosVendedorSchema = datosVendedorSchema;
