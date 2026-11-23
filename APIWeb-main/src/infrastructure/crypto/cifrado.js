/**
 * Cifrado de datos personales con AES-256-GCM (módulo nativo `crypto`).
 * Vive en infraestructura: las entidades de dominio no dependen de él.
 *
 * Formato del token: v1.<iv>.<tag>.<datos>  (todo en base64)
 * El prefijo de versión permite rotar el algoritmo o la clave en el futuro.
 */
const crypto = require('crypto');

const VERSION = 'v1';
const ALGORITMO = 'aes-256-gcm';
const LONGITUD_IV = 12; // tamaño recomendado para GCM

function leerClave(nombre) {
  const clave = Buffer.from(process.env[nombre] || '', 'base64');
  if (clave.length !== 32) {
    throw new Error(`${nombre} debe ser una clave de 32 bytes codificada en base64`);
  }
  return clave;
}

/** Cifra un texto. Devuelve un token seguro para guardar en una columna TEXT. */
function cifrar(texto) {
  if (texto === null || texto === undefined) return texto;
  const iv = crypto.randomBytes(LONGITUD_IV); // nuevo en CADA cifrado
  const cipher = crypto.createCipheriv(ALGORITMO, leerClave('ENCRYPTION_KEY'), iv);
  const datos = Buffer.concat([cipher.update(String(texto), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv, tag, datos].map(p => (Buffer.isBuffer(p) ? p.toString('base64') : p)).join('.');
}

/** Descifra un token. Lanza error si fue alterado o si la clave es incorrecta. */
function descifrar(token) {
  if (token === null || token === undefined) return token;
  const partes = String(token).split('.');
  if (partes.length !== 4 || partes[0] !== VERSION) {
    throw new Error('Formato de token cifrado inválido');
  }
  const [iv, tag, datos] = partes.slice(1).map(p => Buffer.from(p, 'base64'));
  if (iv.length !== LONGITUD_IV) throw new Error('Formato de token cifrado inválido');
  const decipher = crypto.createDecipheriv(ALGORITMO, leerClave('ENCRYPTION_KEY'), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(datos), decipher.final()]).toString('utf8');
}

/**
 * Índice ciego: HMAC-SHA256 determinista para poder buscar por un campo cifrado
 * (p. ej. WHERE correo_idx = indiceCiego(correo)). Usa una clave distinta a la de cifrado.
 */
function indiceCiego(texto) {
  const normalizado = String(texto).trim().toLowerCase();
  return crypto.createHmac('sha256', leerClave('INDEX_KEY')).update(normalizado).digest('hex');
}

module.exports = { cifrar, descifrar, indiceCiego };
