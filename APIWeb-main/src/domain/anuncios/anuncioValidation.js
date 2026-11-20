/**
 * Advertisement input validation (shared by the admin API and the manual
 * house-ad seed script so both enforce the exact same contract).
 *
 * URL policy: HTTPS only. The single exception is local development
 * (NODE_ENV !== 'production'), where http(s) URLs pointing at localhost,
 * 127.0.0.1 or ::1 are accepted so ads can be tested against local servers.
 * URLs with embedded credentials are always rejected.
 */
const { PLACEMENTS } = require('../../infrastructure/models/Anuncio');

const MAX_TITLE = 150;
const MAX_ADVERTISER = 150;
const MAX_DESCRIPTION = 2000;
const MAX_URL = 2048;

const LOCAL_HOSTNAMES = Object.freeze(['localhost', '127.0.0.1', '::1']);

function isProduction(env = process.env) {
  return env.NODE_ENV === 'production';
}

function isAllowedUrl(value, env = process.env) {
  if (typeof value !== 'string') return false;
  const text = value.trim();
  if (text === '' || text.length > MAX_URL) return false;
  let url;
  try {
    url = new URL(text);
  } catch (error) {
    return false;
  }
  // Never allow credentials embedded in ad URLs (phishing vector).
  if (url.username !== '' || url.password !== '') return false;
  if (url.protocol === 'https:') return true;
  if (!isProduction(env) && url.protocol === 'http:') {
    // WHATWG URL keeps IPv6 brackets in hostname ("[::1]"): strip them.
    const host = url.hostname.toLowerCase().replace(/^\[(.*)\]$/, '$1');
    if (LOCAL_HOSTNAMES.includes(host)) return true;
  }
  return false;
}

function parseDate(value) {
  if (value === null || value === undefined || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/**
 * Validates a create/update payload. Returns { value } with the sanitized
 * fields to persist, or { errors } listing one message per invalid field.
 */
function validateAnuncioInput(body = {}, { isUpdate = false } = {}, env = process.env) {
  const errors = [];
  const value = {};
  const input = body && typeof body === 'object' ? body : {};

  const checkText = (field, { required, max, label }) => {
    const raw = input[field];
    if (raw === undefined) {
      if (required && !isUpdate) errors.push(`${label} es obligatorio`);
      return;
    }
    if (typeof raw !== 'string' || raw.trim() === '') {
      if (required || raw !== null) errors.push(`${label} es obligatorio`);
      else value[field] = null;
      return;
    }
    const text = raw.trim();
    if (text.length > max) {
      errors.push(`${label} no puede superar ${max} caracteres`);
      return;
    }
    value[field] = text;
  };

  checkText('title', { required: true, max: MAX_TITLE, label: 'El título' });
  checkText('advertiser', { required: true, max: MAX_ADVERTISER, label: 'El anunciante' });

  if (input.description !== undefined) {
    if (input.description === null || input.description === '') {
      value.description = null;
    } else if (typeof input.description !== 'string') {
      errors.push('La descripción debe ser un texto');
    } else if (input.description.trim().length > MAX_DESCRIPTION) {
      errors.push(`La descripción no puede superar ${MAX_DESCRIPTION} caracteres`);
    } else {
      value.description = input.description.trim() === '' ? null : input.description.trim();
    }
  }

  for (const [field, label] of [['imageUrl', 'La URL de la imagen'], ['targetUrl', 'La URL de destino']]) {
    const raw = input[field];
    if (raw === undefined) {
      if (!isUpdate) errors.push(`${label} es obligatoria`);
      continue;
    }
    if (!isAllowedUrl(raw, env)) {
      errors.push(`${label} debe ser una URL HTTPS válida`
        + (isProduction(env) ? '' : ' (o http://localhost solo en desarrollo)'));
      continue;
    }
    value[field] = raw.trim();
  }

  if (input.placement !== undefined) {
    if (!PLACEMENTS.includes(input.placement)) {
      errors.push(`placement debe ser uno de: ${PLACEMENTS.join(', ')}`);
    } else {
      value.placement = input.placement;
    }
  }

  if (input.active !== undefined) {
    if (typeof input.active !== 'boolean') {
      errors.push('active debe ser un booleano');
    } else {
      value.active = input.active;
    }
  }

  const startAt = input.startAt !== undefined ? parseDate(input.startAt) : 'absent';
  const endAt = input.endAt !== undefined ? parseDate(input.endAt) : 'absent';
  if (startAt === undefined) errors.push('startAt debe ser una fecha válida');
  else if (startAt !== 'absent') value.startAt = startAt;
  if (endAt === undefined) errors.push('endAt debe ser una fecha válida');
  else if (endAt !== 'absent') value.endAt = endAt;
  if (startAt instanceof Date && endAt instanceof Date && startAt > endAt) {
    errors.push('startAt no puede ser posterior a endAt');
  }

  return errors.length > 0 ? { errors } : { value };
}

/**
 * Public projection: only the fields the storefront renders. Scheduling
 * (active/startAt/endAt) and timestamps are administrative and never leave
 * the public endpoint.
 */
function serializeAnuncioPublico(anuncio) {
  if (!anuncio) return anuncio;
  return {
    id: anuncio.id,
    title: anuncio.title,
    description: anuncio.description ?? null,
    imageUrl: anuncio.imageUrl,
    targetUrl: anuncio.targetUrl,
    advertiser: anuncio.advertiser,
    placement: anuncio.placement,
  };
}

module.exports = {
  PLACEMENTS,
  MAX_TITLE,
  MAX_ADVERTISER,
  MAX_DESCRIPTION,
  MAX_URL,
  LOCAL_HOSTNAMES,
  isAllowedUrl,
  validateAnuncioInput,
  serializeAnuncioPublico,
};
