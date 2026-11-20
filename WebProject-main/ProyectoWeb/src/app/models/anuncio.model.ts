export interface Anuncio {
  id: number;
  titulo: string;
  mensaje?: string;
  productoId: number;
  imagenUrl?: string;
  precio?: number;
  activo?: boolean;
}
