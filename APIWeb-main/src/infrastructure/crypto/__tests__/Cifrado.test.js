const crypto = require('crypto');
const { cifrar, descifrar, indiceCiego } = require('../cifrado');

const clave = () => crypto.randomBytes(32).toString('base64');

describe('Cifrado AES-256-GCM', () => {
  beforeEach(() => {
    process.env.ENCRYPTION_KEY = clave();
    process.env.INDEX_KEY = clave();
  });

  it('descifra lo que cifró, incluyendo acentos y emojis', () => {
    const texto = 'kevin.trejo@unam.mx · Ciudad Universitaria 🐾';
    expect(descifrar(cifrar(texto))).toBe(texto);
  });

  it('produce tokens distintos para el mismo texto (IV aleatorio)', () => {
    expect(cifrar('5512345678')).not.toBe(cifrar('5512345678'));
  });

  it('no deja el texto original visible en el token', () => {
    expect(cifrar('5512345678')).not.toContain('5512345678');
  });

  it('rechaza un token alterado', () => {
    const partes = cifrar('dato sensible').split('.');
    const datos = Buffer.from(partes[3], 'base64');
    datos[0] ^= 1;
    partes[3] = datos.toString('base64');
    expect(() => descifrar(partes.join('.'))).toThrow();
  });

  it('rechaza descifrar con otra clave', () => {
    const token = cifrar('dato sensible');
    process.env.ENCRYPTION_KEY = clave();
    expect(() => descifrar(token)).toThrow();
  });

  it('rechaza formatos inválidos', () => {
    expect(() => descifrar('basura')).toThrow('Formato de token cifrado inválido');
    expect(() => descifrar('v1.aaaa.bbbb.cccc')).toThrow('Formato de token cifrado inválido');
  });

  it('exige una clave de 32 bytes', () => {
    process.env.ENCRYPTION_KEY = Buffer.from('corta').toString('base64');
    expect(() => cifrar('x')).toThrow('ENCRYPTION_KEY debe ser una clave de 32 bytes');
    delete process.env.ENCRYPTION_KEY;
    expect(() => cifrar('x')).toThrow('ENCRYPTION_KEY');
  });

  it('conserva null y undefined', () => {
    expect(cifrar(null)).toBeNull();
    expect(descifrar(undefined)).toBeUndefined();
  });
});

describe('Índice ciego', () => {
  beforeEach(() => {
    process.env.ENCRYPTION_KEY = clave();
    process.env.INDEX_KEY = clave();
  });

  it('es determinista e ignora mayúsculas y espacios', () => {
    expect(indiceCiego(' Kevin@UNAM.mx ')).toBe(indiceCiego('kevin@unam.mx'));
  });

  it('cambia con otro texto y con otra clave', () => {
    const a = indiceCiego('a@unam.mx');
    expect(a).not.toBe(indiceCiego('b@unam.mx'));
    process.env.INDEX_KEY = clave();
    expect(a).not.toBe(indiceCiego('a@unam.mx'));
  });

  it('exige INDEX_KEY válida', () => {
    delete process.env.INDEX_KEY;
    expect(() => indiceCiego('a')).toThrow('INDEX_KEY');
  });
});
