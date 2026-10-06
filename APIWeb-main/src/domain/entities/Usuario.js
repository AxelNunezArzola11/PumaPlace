/** Modelo mínimo: traslada la regla de edad que ya existe en test_dominio.py. */
class Usuario {
  constructor({ id = null, edad }) {
    if (!Usuario.esEdadValidaParaRegistro(edad))
      throw new Error('El usuario debe tener una edad entera mayor o igual a 18');
    this.id = id;
    this.edad = edad;
  }
  static esEdadValidaParaRegistro(edad) {
    return Number.isSafeInteger(edad) && edad >= 18;
  }
}
module.exports = Usuario;
