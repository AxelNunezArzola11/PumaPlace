// Local fallback. Render overwrites this file at build time from API_URL
// via scripts/generate-environment.mjs — never hardcode a backend URL here.
export const environment = {
  production: true,
  apiUrl: 'http://localhost:3000/api',
  advertisementsEnabled: true,
};
