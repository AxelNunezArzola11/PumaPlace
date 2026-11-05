import { Producto } from './producto.model';

export interface ItemCarrito {
  productoId?: number;
  producto?: Producto;
  cantidad: number;
  precio?: number;
}

export interface Carrito {
  id?: number;
  usuarioId?: number;
  items: ItemCarrito[];
  subtotal?: number;
  descuento?: number;
  total?: number;
  estado?: string;
}