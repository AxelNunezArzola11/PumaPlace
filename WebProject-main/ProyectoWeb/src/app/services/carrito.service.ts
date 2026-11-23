import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, catchError, finalize, forkJoin, map, of, shareReplay, switchMap, throwError } from 'rxjs';
import { ApiService } from './api.service';
import { AuthService } from './auth.service';
import { ProductoService } from './producto.service';
import { Producto } from '../models/producto.model';
import { Carrito } from '../models/carrito.model';
import { Orden } from '../models/orden.model';

export interface CarritoItem {
  id: number;
  name: string;
  price: number;
  image_url?: string;
  quantity: number;
  stock: number;
}

export interface CompraResultado {
  success: boolean;
  orden?: Orden;
  resumed?: boolean;
}

export interface CheckoutPendiente {
  ordenId: number;
  userId: number | null;
  items: { id: number; quantity: number }[];
}

const CART_KEY = (userId: number | null) => `pumaplace.cart.v1.${userId ?? 'anon'}`;
const PENDING_KEY = (userId: number | null) => `pumaplace.pending.v1.${userId ?? 'anon'}`;
const RECOVERED_KEY = (userId: number | null) => `pumaplace.recovered.v1.${userId ?? 'anon'}`;
const OPEN_STATES = ['pendiente', 'procesando'];

function leerJSON<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : null;
  } catch {
    return null;
  }
}

function escribirJSON(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage lleno o bloqueado: el carrito en memoria sigue funcionando.
  }
}

function validarItems(items: unknown): CarritoItem[] {
  if (!Array.isArray(items)) return [];
  const validos: CarritoItem[] = [];
  for (const item of items) {
    const id = Number((item as CarritoItem)?.id);
    const quantity = Number((item as CarritoItem)?.quantity);
    if (!Number.isSafeInteger(id) || id <= 0 || !Number.isSafeInteger(quantity) || quantity <= 0) continue;
    validos.push({
      id,
      name: String((item as CarritoItem)?.name ?? `Producto #${id}`),
      price: Number((item as CarritoItem)?.price ?? 0),
      image_url: (item as CarritoItem)?.image_url,
      quantity,
      stock: Number((item as CarritoItem)?.stock ?? 0),
    });
  }
  return validos;
}

@Injectable({ providedIn: 'root' })
export class CarritoService {
  private readonly itemsSubject = new BehaviorSubject<CarritoItem[]>([]);
  readonly carritoItems$ = this.itemsSubject.asObservable();
  private usuarioId: number | null;
  private readonly recuperacionesEnVuelo = new Map<number, Observable<CarritoItem[]>>();

  constructor(
    private readonly api: ApiService,
    private readonly authService: AuthService,
    private readonly productoService: ProductoService,
  ) {
    this.usuarioId = this.authService.getUsuarioActual()?.id ?? null;
    this.itemsSubject.next(this.leerGuardado(this.usuarioId));
    // El carrito persiste por usuario: al cambiar de cuenta se guarda el
    // actual y se carga el de la nueva cuenta (o uno vacío).
    this.authService.usuario$.subscribe(usuario => {
      const id = usuario?.id ?? null;
      if (id !== this.usuarioId) {
        this.persistir(this.usuarioId, this.itemsSubject.value);
        this.usuarioId = id;
        this.itemsSubject.next(this.leerGuardado(id));
      }
    });
    this.carritoItems$.subscribe(items => this.persistir(this.usuarioId, items));
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
      existing.quantity = Math.min(existing.stock || Number.MAX_SAFE_INTEGER, existing.quantity + cantidad);
      existing.image_url ||= producto.image_url || producto.imagenUrl;
    } else {
      items.push({
      id: producto.id,
      name: producto.name || producto.nombre,
      price: Number(producto.price ?? producto.precio),
      image_url: producto.image_url || producto.imagenUrl,
      quantity: cantidad,
      stock: Number(producto.stock ?? producto.cantidadDisponible ?? producto.inventario?.cantidadDisponible ?? 0),
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
  tieneArticulos(): boolean { return this.itemsSubject.value.length > 0; }
  vaciarCarrito(): void {
    this.itemsSubject.next([]);
    this.limpiarPendiente(this.usuarioId);
  }
  obtenerCantidadTotal(): Observable<number> { return this.carritoItems$.pipe(map(items => items.reduce((sum, item) => sum + item.quantity, 0))); }
  obtenerPrecioTotal(): Observable<number> { return this.carritoItems$.pipe(map(items => items.reduce((sum, item) => sum + item.price * item.quantity, 0))); }

  sincronizarConBackend(): Observable<Carrito | null> {
    return this.api.get<Carrito | null>('carrito/activo');
  }
  agregarAlCarrito(productoId: number, cantidad = 1): Observable<Carrito> {
    return this.api.post<Carrito>('carrito/items', { productoId, cantidad });
  }

  /**
   * Restaura el carrito local desde una orden abandonada del comprador. El
   * backend cancela la orden si sigue abierta (reclamo atómico) y devuelve
   * el carrito; aquí se enriquece con los datos visibles del producto.
   * Las líneas de productos eliminados se omiten sin fallar.
   *
   * IDEMPOTENTE: cada orden se fusiona una sola vez por dispositivo (conjunto
   * persistido `pumaplace.recovered.v1.*`), las llamadas concurrentes para la
   * misma orden comparten una sola petición HTTP, y el veredicto del backend
   * (`recovered: false`) gana siempre — repetir la recuperación jamás duplica
   * cantidades. El backend es la autoridad (precios, stock, propiedad y pago
   * se validan allá); localStorage solo evita remezclar lo ya restaurado.
   */
  recuperarCarrito(ordenId: number): Observable<CarritoItem[]> {
    const userId = this.usuarioId;
    if (!Number.isSafeInteger(ordenId) || ordenId <= 0) {
      return throwError(() => new Error('Orden inválida'));
    }
    if (this.leerRecuperadas(userId).includes(ordenId)) return of([]);
    const enVuelo = this.recuperacionesEnVuelo.get(ordenId);
    if (enVuelo) return enVuelo;
    const peticion = this.api.post<{ cart: Carrito; ordenId: number; recovered?: boolean }>('carrito/recuperar', { ordenId }).pipe(
      switchMap((respuesta) => {
        if (respuesta?.recovered === false) {
          this.marcarRecuperada(userId, ordenId);
          return of([] as CarritoItem[]);
        }
        const lineas = (respuesta?.cart?.items ?? []).filter(item =>
          Number.isSafeInteger(Number(item?.productoId)) && Number(item?.productoId) > 0
          && Number.isSafeInteger(Number(item?.cantidad)) && Number(item?.cantidad) > 0);
        if (!lineas.length) return of([] as CarritoItem[]);
        return forkJoin(lineas.map(linea =>
          this.productoService.obtenerProducto(Number(linea.productoId)).pipe(
            map((producto): CarritoItem | null => ({
              id: producto.id,
              name: producto.name || producto.nombre,
              price: Number(producto.price ?? producto.precio),
              image_url: producto.image_url || producto.imagenUrl,
              quantity: Number(linea.cantidad),
              stock: Number(producto.stock ?? 0),
            })),
            catchError(() => of(null)),
          ),
        )).pipe(map(items => items.filter((item): item is CarritoItem => item !== null)));
      }),
      map(recuperados => {
        this.marcarRecuperada(userId, ordenId);
        if (recuperados.length) {
          const combinados = [...this.itemsSubject.value];
          for (const item of recuperados) {
            const existing = combinados.find(current => current.id === item.id);
            if (existing) existing.quantity += item.quantity;
            else combinados.push(item);
          }
          this.itemsSubject.next(combinados);
        }
        return recuperados;
      }),
      finalize(() => this.recuperacionesEnVuelo.delete(ordenId)),
      shareReplay(1),
    );
    this.recuperacionesEnVuelo.set(ordenId, peticion);
    return peticion;
  }

  /**
   * Envía el carrito local al backend y crea la orden. El carrito local NO se
   * vacía aquí: solo se concilia cuando el backend confirma el pago
   * (ver reconciliarTrasPago), así abandonar Mercado Pago no pierde la compra.
   * Si ya existe un checkout pendiente abierto para este usuario, se retoma
   * en lugar de crear una segunda orden y una segunda reserva.
   */
  procesarCompra(puntoEntrega = 'Punto de entrega por acordar'): Observable<CompraResultado> {
    if (!this.itemsSubject.value.length) {
      return throwError(() => new Error('El carrito está vacío'));
    }
    const userId = this.usuarioId;
    const pendiente = this.leerPendiente(userId);

    const crearNueva = () => {
      const payload = {
        items: this.itemsSubject.value.map(item => ({ productoId: item.id, cantidad: item.quantity })),
      };
      return this.api.put<Carrito>('carrito/items', payload).pipe(
        switchMap(() => this.api.post<Orden>('ordenes', { puntoEntrega })),
        map(orden => {
          if (orden?.id) {
            this.guardarPendiente(userId, {
              ordenId: orden.id,
              userId,
              items: this.itemsSubject.value.map(item => ({ id: item.id, quantity: item.quantity })),
            });
          }
          return { success: true, orden, resumed: false };
        }),
      );
    };

    if (!pendiente?.ordenId) return crearNueva();
    return this.api.get<Orden>(`ordenes/${pendiente.ordenId}`).pipe(
      map(orden => ({ orden, abierta: OPEN_STATES.includes(orden?.estado) })),
      catchError(() => of({ orden: null as unknown as Orden, abierta: false })),
      switchMap(({ orden, abierta }) => {
        if (abierta && orden) return of({ success: true, orden, resumed: true });
        this.limpiarPendiente(userId);
        return crearNueva();
      }),
    );
  }

  /**
   * Concilia el carrito local SOLO con pago confirmado por el backend.
   * Resta únicamente las unidades de la orden pagada, para no borrar
   * artículos agregados después de iniciar el checkout.
   */
  reconciliarTrasPago(ordenId: number): Observable<{ reconciliado: boolean }> {
    const userId = this.usuarioId;
    return this.api.get<Orden>(`ordenes/${ordenId}`).pipe(
      map(orden => {
        if (orden?.estado !== 'pagada') return { reconciliado: false };
        const pendiente = this.leerPendiente(userId);
        if (pendiente?.ordenId === ordenId) {
          const restantes = new Map(pendiente.items.map(item => [item.id, item.quantity]));
          const items: CarritoItem[] = [];
          for (const item of this.itemsSubject.value) {
            const quitar = Math.min(restantes.get(item.id) ?? 0, item.quantity);
            restantes.set(item.id, (restantes.get(item.id) ?? 0) - quitar);
            if (item.quantity - quitar > 0) items.push({ ...item, quantity: item.quantity - quitar });
          }
          this.itemsSubject.next(items);
          this.limpiarPendiente(userId);
        }
        return { reconciliado: true };
      }),
    );
  }

  leerCheckoutPendiente(): CheckoutPendiente | null {
    return this.leerPendiente(this.usuarioId);
  }

  private changeQuantity(id: number, delta: number): void {
    const items = this.itemsSubject.value.map(item => item.id === id
      ? { ...item, quantity: Math.min(item.stock || Number.MAX_SAFE_INTEGER, Math.max(1, item.quantity + delta)) } : item);
    this.itemsSubject.next(items);
  }

  private leerGuardado(userId: number | null): CarritoItem[] {
    return validarItems(leerJSON<unknown>(CART_KEY(userId)));
  }

  private persistir(userId: number | null, items: CarritoItem[]): void {
    escribirJSON(CART_KEY(userId), items);
  }

  private leerPendiente(userId: number | null): CheckoutPendiente | null {
    const raw = leerJSON<CheckoutPendiente>(PENDING_KEY(userId));
    if (!raw || !Number.isSafeInteger(Number(raw.ordenId)) || Number(raw.ordenId) <= 0) return null;
    return { ordenId: Number(raw.ordenId), userId: raw.userId ?? null, items: validarItems(raw.items).map(i => ({ id: i.id, quantity: i.quantity })) };
  }

  private guardarPendiente(userId: number | null, pendiente: CheckoutPendiente): void {
    escribirJSON(PENDING_KEY(userId), pendiente);
  }

  private limpiarPendiente(userId: number | null): void {
    try {
      localStorage.removeItem(PENDING_KEY(userId));
    } catch {
      // Sin almacenamiento: nada que limpiar.
    }
  }

  private leerRecuperadas(userId: number | null): number[] {
    const raw = leerJSON<unknown>(RECOVERED_KEY(userId));
    if (!Array.isArray(raw)) return [];
    return raw.map(Number).filter(id => Number.isSafeInteger(id) && id > 0);
  }

  private marcarRecuperada(userId: number | null, ordenId: number): void {
    const ids = this.leerRecuperadas(userId);
    if (!ids.includes(ordenId)) escribirJSON(RECOVERED_KEY(userId), [...ids, ordenId]);
  }
}
