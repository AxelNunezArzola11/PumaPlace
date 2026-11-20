#!/usr/bin/env node
/**
 * Generates src/environments/environment.prod.ts from the API_URL build-time
 * environment variable (Render Static Site build command).
 *
 * Usage (Render buildCommand):
 *   node scripts/generate-environment.mjs && npm run build -- --configuration production
 *
 * API_URL must be the absolute public backend URL INCLUDING the /api prefix,
 * e.g. https://puma-place-api.onrender.com/api
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const target = join(here, '..', 'src', 'environments', 'environment.prod.ts');

function fail(message) {
  console.error(`generate-environment → ERROR: ${message}`);
  process.exit(1);
}

const raw = (process.env.API_URL || '').trim();
if (!raw) fail('API_URL no está definida. Ejemplo: API_URL=https://puma-place-api.onrender.com/api');
let url;
try {
  url = new URL(raw);
} catch {
  fail(`API_URL no es una URL válida: ${raw}`);
}
if (!['http:', 'https:'].includes(url.protocol)) fail(`API_URL debe ser http(s): ${raw}`);
if (!url.pathname || url.pathname === '/') {
  fail(`API_URL debe incluir el prefijo /api: ${raw}`);
}
const apiUrl = raw.replace(/\/+$/, '');

writeFileSync(
  `${target}`,
  `// GENERATED at build time by scripts/generate-environment.mjs — do not edit.\n`
    + `export const environment = {\n`
    + `  production: true,\n`
    + `  apiUrl: '${apiUrl}',\n`
    + `  advertisementsEnabled: true,\n`
    + `};\n`,
);
console.log(`generate-environment → environment.prod.ts generado con apiUrl=${apiUrl}`);
