import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, map, of } from 'rxjs';
import { ApiService } from './api.service';
import { Producto } from '../models/producto.model';
import { Carrito } from '../models/carrito.model';

export interface CarritoItem {
  id: number;
  name: string;
  price: number;
  image_url?: string;
  quantity: number;
}

@Injectable({ providedIn: 'root' })
export class CarritoService {
  private readonly itemsSubject = new BehaviorSubject<CarritoItem[]>([]);
  readonly carritoItems$ = this.itemsSubject.asObservable();

  constructor(private readonly api: ApiService) {}

  agregarProducto(producto: Producto, cantidad = 1): void {
    const items = [...this.itemsSubject.value];
    const existing = items.find(item => item.id === producto.id);
    if (existing) {
      existing.quantity += cantidad;
      existing.image_url ||= producto.image_url || producto.imagenUrl;
    } else {
      items.push({
      id: producto.id,
      name: producto.name || producto.nombre,
      price: Number(producto.price ?? producto.precio),
      image_url: producto.image_url || producto.imagenUrl,
      quantity: cantidad,
      });
    }
    this.itemsSubject.next(items);
  }
  aumentarCantidad(id: number): void { this.changeQuantity(id, 1); }
  disminuirCantidad(id: number): void {
    const item = this.itemsSubject.value.find(current => current.id === id);
    if (item && item.quantity === 1) this.eliminarProducto(id); else this.changeQuantity(id, -1);
  }
  eliminarProducto(id: number): void { this.itemsSubject.next(this.itemsSubject.value.filter(item => item.id !== id)); }
  vaciarCarrito(): void { this.itemsSubject.next([]); }
  obtenerCantidadTotal(): Observable<number> { return this.carritoItems$.pipe(map(items => items.reduce((sum, item) => sum + item.quantity, 0))); }
  obtenerPrecioTotal(): Observable<number> { return this.carritoItems$.pipe(map(items => items.reduce((sum, item) => sum + item.price * item.quantity, 0))); }

  sincronizarConBackend(): Observable<Carrito> { return this.api.get<Carrito[]>('carrito').pipe(map(carritos => carritos[0])); }
  agregarAlCarrito(productoId: number, cantidad = 1): Observable<Carrito> {
    return this.api.post<Carrito>('carrito/items', { productoId, cantidad });
  }
  procesarCompra(): Observable<{ success: boolean }> { return of({ success: true }); }

  private changeQuantity(id: number, delta: number): void {
    const items = this.itemsSubject.value.map(item => item.id === id
      ? { ...item, quantity: Math.max(1, item.quantity + delta) } : item);
    this.itemsSubject.next(items);
  }
}
