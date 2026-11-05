import { Producto } from './producto.model';

export interface ItemOrden {
  producto: Producto;
  cantidad: number;
  precioUnitario: number;
  subtotal: number;
}

export interface DireccionEnvio {
  calle: string;
  ciudad: string;
  estado: string;
  codigoPostal: string;
  pais: string;
}

export type EstadoOrden = 'pendiente' | 'pagada' | 'enviada' | 'entregada' | 'cancelada';

export interface Orden {
  id?: number;
  userId: number;
  items: ItemOrden[];
  total: number;
  fechaCreacion?: Date;
  estado: EstadoOrden;
  direccionEnvio: DireccionEnvio;
  metodoPago: string;
} 