import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, map, switchMap, tap, throwError } from 'rxjs';
import { ApiService } from './api.service';
import { AuthService } from './auth.service';
import { Producto } from '../models/producto.model';
import { Carrito } from '../models/carrito.model';
import { Orden } from '../models/orden.model';

export interface CarritoItem {
  id: number;
  name: string;
  price: number;
  image_url?: string;
  quantity: number;
}

export interface CompraResultado {
  success: boolean;
  orden?: Orden;
}

@Injectable({ providedIn: 'root' })
export class CarritoService {
  private readonly itemsSubject = new BehaviorSubject<CarritoItem[]>([]);
  readonly carritoItems$ = this.itemsSubject.asObservable();
  private usuarioId: number | null;

  constructor(
    private readonly api: ApiService,
    private readonly authService: AuthService
  ) {
    this.usuarioId = this.authService.getUsuarioActual()?.id ?? null;
    // El carrito es una sesión de usuario: al cerrar sesión o entrar con
    // otra cuenta se descarta para no mostrar artículos de otra persona.
    this.authService.usuario$.subscribe(usuario => {
      const id = usuario?.id ?? null;
      if (id !== this.usuarioId) {
        this.usuarioId = id;
        this.itemsSubject.next([]);
      }
    });
  }

  agregarProducto(producto: Producto, cantidad = 1): void {
    const usuarioId = this.authService.getUsuarioActual()?.id;
    const vendedorId = producto.vendedorId ?? producto.user_id ?? producto.seller?.id;
    if (usuarioId && vendedorId && Number(usuarioId) === Number(vendedorId)) {
      throw new Error('No puedes agregar tus propios productos al carrito');
    }

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

  sincronizarConBackend(): Observable<Carrito | null> {
    return this.api.get<Carrito | null>('carrito/activo');
  }
  agregarAlCarrito(productoId: number, cantidad = 1): Observable<Carrito> {
    return this.api.post<Carrito>('carrito/items', { productoId, cantidad });
  }

  /**
   * Envía el carrito local al backend y crea la orden. Al crear la orden el
   * backend reserva el inventario, por lo que el stock queda actualizado.
   */
  procesarCompra(puntoEntrega = 'Punto de entrega por acordar'): Observable<CompraResultado> {
    const items = this.itemsSubject.value;
    if (!items.length) {
      return throwError(() => new Error('El carrito está vacío'));
    }

    const payload = {
      items: items.map(item => ({ productoId: item.id, cantidad: item.quantity })),
    };

    return this.api.put<Carrito>('carrito/items', payload).pipe(
      switchMap(() => this.api.post<Orden>('ordenes', { puntoEntrega })),
      tap(() => this.itemsSubject.next([])),
      map(orden => ({ success: true, orden })),
    );
  }

  private changeQuantity(id: number, delta: number): void {
    const items = this.itemsSubject.value.map(item => item.id === id
      ? { ...item, quantity: Math.max(1, item.quantity + delta) } : item);
    this.itemsSubject.next(items);
  }
}
