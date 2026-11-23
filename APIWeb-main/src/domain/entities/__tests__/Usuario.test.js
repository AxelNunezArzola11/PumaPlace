const Usuario = require('../Usuario');
describe('Usuario', () => {
  it.each([18, 20])('acepta edad %s', edad => {
    expect(new Usuario({ edad }).edad).toBe(edad);
  });
  it.each([17, 15, -1, 18.5, NaN, Infinity, '20', undefined])('rechaza edad %s', edad => {
    expect(Usuario.esEdadValidaParaRegistro(edad)).toBe(false);
    expect(() => new Usuario({ edad })).toThrow(/edad/);
  });
});
