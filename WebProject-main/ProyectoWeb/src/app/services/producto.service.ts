import { Injectable } from '@angular/core';
import { Observable, map } from 'rxjs';
import { ApiService } from './api.service';
import { CreateProductoDTO, Producto } from '../models/producto.model';

@Injectable({ providedIn: 'root' })
export class ProductoService {
  constructor(private readonly api: ApiService) {}

  obtenerProductos(filters?: { q?: string; categoriaId?: number; precioMin?: number; precioMax?: number; page?: number; limit?: number }): Observable<Producto[]> {
    return this.api.get<Producto[]>('productos', filters).pipe(map(items => items.map(item => this.normalize(item))));
  }
  obtenerProductosPorCategoria(categoriaId: number): Observable<Producto[]> { return this.obtenerProductos({ categoriaId }); }
  obtenerProductosPorVendedor(): Observable<Producto[]> { return this.obtenerProductos(); }
  obtenerProducto(id: number): Observable<Producto> {
    return this.api.get<Producto>(`productos/${id}`).pipe(map(item => this.normalize(item)));
  }
  crearProducto(producto: CreateProductoDTO): Observable<Producto> {
    return this.api.post<Producto>('productos', producto).pipe(map(item => this.normalize(item)));
  }
  actualizarProducto(id: number, producto: Partial<CreateProductoDTO>): Observable<Producto> {
    return this.api.patch<Producto>(`productos/${id}`, producto).pipe(map(item => this.normalize(item)));
  }
  eliminarProducto(id: number): Observable<unknown> { return this.api.delete(`productos/${id}`); }

  private normalize(item: Producto): Producto {
    return {
      ...item,
      name: item.nombre,
      description: item.descripcion,
      price: item.precio,
      category_product_id: item.categoriaId,
      stock: item.cantidadDisponible ?? item.inventario?.cantidadDisponible ?? 0,
      image_url: this.normalizeImageUrl(item.imagenUrl),
    };
  }

  private normalizeImageUrl(url?: string): string | undefined {
    if (!url) return undefined;
    if (!url.includes('ibb.co') || url.includes('i.ibb.co')) return url;

    const match = url.match(/(?:https?:\/\/)?(?:www\.)?ibb\.co\/([A-Za-z0-9]+)/);
    return match?.[1] ? `https://i.ibb.co/${match[1]}/image.jpg` : url;
  }
}
