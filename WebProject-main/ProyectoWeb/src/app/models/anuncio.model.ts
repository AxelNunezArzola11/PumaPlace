/**
 * Public advertisement projection from `GET /api/anuncios/activos`.
 * Scheduling (active/startAt/endAt) and timestamps are administrative and
 * are never exposed by the public endpoint.
 */
export interface Anuncio {
  id: number;
  title: string;
  description?: string | null;
  imageUrl: string;
  targetUrl: string;
  advertiser: string;
  placement?: string;
}
