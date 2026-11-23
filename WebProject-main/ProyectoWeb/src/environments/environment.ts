export const environment = {
  production: false,
  apiUrl: 'http://localhost:3000/api',
  // Integración de anuncios: el backend sirve GET /api/anuncios/activos y
  // el catálogo muestra los anuncios vigentes. Poner en false solo como
  // interruptor de emergencia (oculta toda la publicidad).
  advertisementsEnabled: true,
};
