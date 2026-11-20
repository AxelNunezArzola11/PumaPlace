export const environment = {
  production: false,
  apiUrl: 'http://localhost:3000/api',
  // Integración de anuncios: requiere el endpoint GET /api/anuncios/activos,
  // que aún no existe en el backend. Mantener en false hasta entonces.
  advertisementsEnabled: false,
};
