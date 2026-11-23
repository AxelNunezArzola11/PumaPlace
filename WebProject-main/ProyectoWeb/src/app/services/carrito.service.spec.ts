import { TestBed } from '@angular/core/testing';
import { BehaviorSubject, of, throwError } from 'rxjs';
import { CarritoService } from './carrito.service';
import { ApiService } from './api.service';
import { AuthService } from './auth.service';
import { ProductoService } from './producto.service';

describe('CarritoService', () => {
  let service: CarritoService;
  let api: jasmine.SpyObj<ApiService>;
  let usuario$: BehaviorSubject<{ id: number } | null>;
  let auth: { usuario$: unknown; getUsuarioActual: jasmine.Spy };
  let productos: jasmine.SpyObj<ProductoService>;

  const producto9 = {
    id: 9, nombre: 'Laptop', descripcion: 'Equipo de cómputo', precio: 100,
    categoriaId: 2, vendedorId: 2, cantidadDisponible: 5, stock: 5,
  };
  const storedCart = () => JSON.parse(localStorage.getItem('pumaplace.cart.v1.1') ?? 'null');
  const storedPending = () => JSON.parse(localStorage.getItem('pumaplace.pending.v1.1') ?? 'null');
  const storedRecovered = () => JSON.parse(localStorage.getItem('pumaplace.recovered.v1.1') ?? 'null');

  beforeEach(() => {
    localStorage.clear();
    api = jasmine.createSpyObj('ApiService', ['get', 'post', 'put', 'patch', 'delete']);
    usuario$ = new BehaviorSubject<{ id: number } | null>({ id: 1 });
    auth = {
      usuario$: usuario$.asObservable(),
      getUsuarioActual: jasmine.createSpy('getUsuarioActual').and.returnValue({ id: 1 }),
    };
    productos = jasmine.createSpyObj('ProductoService', ['obtenerProducto']);
    TestBed.configureTestingModule({
      providers: [
        CarritoService,
        { provide: ApiService, useValue: api },
        { provide: AuthService, useValue: auth },
        { provide: ProductoService, useValue: productos },
      ],
    });
    service = TestBed.inject(CarritoService);
  });

  afterEach(() => {
    localStorage.clear();
  });

  function items(): { id: number; quantity: number }[] {
    let current: { id: number; quantity: number }[] = [];
    service.carritoItems$.subscribe(list => {
      current = list;
    }).unsubscribe();
    return current;
  }

  it('persists the cart and restores it on a new instance (reload)', () => {
    service.agregarProducto(producto9 as never, 2);
    expect(storedCart().length).toBe(1);

    const reloaded = new CarritoService(api, auth as never, productos);
    let current: unknown[] = [];
    reloaded.carritoItems$.subscribe(list => {
      current = list;
    }).unsubscribe();
    expect(current).toEqual([jasmine.objectContaining({ id: 9, quantity: 2 })]);
  });

  it('isolates carts per user across account switches', () => {
    service.agregarProducto(producto9 as never, 1);
    usuario$.next({ id: 2 });
    expect(items()).toEqual([]);
    expect(storedCart()).toEqual([jasmine.objectContaining({ id: 9 })]);
    usuario$.next({ id: 1 });
    expect(items()).toEqual([jasmine.objectContaining({ id: 9, quantity: 1 })]);
  });

  it('resumes an open pending checkout instead of creating a second order', (done) => {
    service.agregarProducto(producto9 as never, 1);
    localStorage.setItem('pumaplace.pending.v1.1', JSON.stringify({ ordenId: 5, userId: 1, items: [{ id: 9, quantity: 1 }] }));
    api.get.and.returnValue(of({ estado: 'pendiente' }));

    service.procesarCompra().subscribe(resultado => {
      expect(resultado.resumed).toBeTrue();
      expect(api.put).not.toHaveBeenCalled();
      expect(api.post).not.toHaveBeenCalled();
      expect(items().length).toBe(1);
      done();
    });
  });

  it('creates a new order when the pending one is terminal, without clearing the cart', (done) => {
    service.agregarProducto(producto9 as never, 1);
    localStorage.setItem('pumaplace.pending.v1.1', JSON.stringify({ ordenId: 5, userId: 1, items: [] }));
    api.get.and.returnValue(of({ estado: 'cancelada' }));
    api.put.and.returnValue(of({}));
    api.post.and.returnValue(of({ id: 50 }));

    service.procesarCompra().subscribe(resultado => {
      expect(resultado.resumed).toBeFalse();
      expect(api.post).toHaveBeenCalled();
      expect(storedPending().ordenId).toBe(50);
      expect(items()).toEqual([jasmine.objectContaining({ id: 9, quantity: 1 })]);
      done();
    });
  });

  it('reconciles only paid-order units, keeping items added after checkout', (done) => {
    service.agregarProducto(producto9 as never, 3);
    service.agregarProducto({ ...producto9, id: 7, nombre: 'Mouse' } as never, 1);
    localStorage.setItem('pumaplace.pending.v1.1', JSON.stringify({ ordenId: 5, userId: 1, items: [{ id: 9, quantity: 2 }] }));
    api.get.and.returnValue(of({ estado: 'pagada' }));

    service.reconciliarTrasPago(5).subscribe(resultado => {
      expect(resultado).toEqual({ reconciliado: true });
      expect(items()).toEqual([
        jasmine.objectContaining({ id: 9, quantity: 1 }),
        jasmine.objectContaining({ id: 7, quantity: 1 }),
      ]);
      expect(storedPending()).toBeNull();
      done();
    });
  });

  it('never reconciles without a backend-confirmed payment', (done) => {
    service.agregarProducto(producto9 as never, 1);
    localStorage.setItem('pumaplace.pending.v1.1', JSON.stringify({ ordenId: 5, userId: 1, items: [{ id: 9, quantity: 1 }] }));
    api.get.and.returnValue(of({ estado: 'pendiente' }));

    service.reconciliarTrasPago(5).subscribe(resultado => {
      expect(resultado).toEqual({ reconciliado: false });
      expect(items().length).toBe(1);
      expect(storedPending().ordenId).toBe(5);
      done();
    });
  });

  it('recovers the cart from the backend, skipping missing products', (done) => {
    api.post.and.returnValue(of({
      cart: { items: [{ productoId: 9, cantidad: 2 }, { productoId: 404, cantidad: 1 }] },
      ordenId: 8,
    }));
    productos.obtenerProducto.and.callFake((id: number) => (id === 9
      ? of({ ...producto9 })
      : throwError(() => new Error('gone'))));

    service.recuperarCarrito(8).subscribe(recuperados => {
      expect(recuperados).toEqual([jasmine.objectContaining({ id: 9, quantity: 2 })]);
      expect(items()).toEqual([jasmine.objectContaining({ id: 9, quantity: 2 })]);
      done();
    });
  });

  it('ignores sequential repeats of the same recovery (no double merge)', (done) => {
    api.post.and.returnValue(of({
      cart: { items: [{ productoId: 9, cantidad: 2 }] },
      ordenId: 8,
      recovered: true,
    }));
    productos.obtenerProducto.and.returnValue(of({ ...producto9 }));

    service.recuperarCarrito(8).subscribe(() => {
      expect(items()).toEqual([jasmine.objectContaining({ id: 9, quantity: 2 })]);
      expect(storedRecovered()).toEqual([8]);
      service.recuperarCarrito(8).subscribe(segunda => {
        expect(segunda).toEqual([]);
        expect(api.post).toHaveBeenCalledTimes(1);
        expect(items()).toEqual([jasmine.objectContaining({ id: 9, quantity: 2 })]);
        done();
      });
    });
  });

  it('shares a single HTTP call across concurrent recoveries of the same order', (done) => {
    api.post.and.returnValue(of({
      cart: { items: [{ productoId: 9, cantidad: 2 }] },
      ordenId: 8,
      recovered: true,
    }));
    productos.obtenerProducto.and.returnValue(of({ ...producto9 }));
    let completadas = 0;
    const verificar = () => {
      completadas += 1;
      if (completadas === 2) {
        expect(api.post).toHaveBeenCalledTimes(1);
        expect(items()).toEqual([jasmine.objectContaining({ id: 9, quantity: 2 })]);
        done();
      }
    };
    service.recuperarCarrito(8).subscribe(verificar);
    service.recuperarCarrito(8).subscribe(verificar);
  });

  it('merges nothing when the backend reports already-recovered', (done) => {
    service.agregarProducto(producto9 as never, 1);
    api.post.and.returnValue(of({
      cart: { items: [{ productoId: 9, cantidad: 2 }] },
      ordenId: 8,
      recovered: false,
    }));

    service.recuperarCarrito(8).subscribe(recuperados => {
      expect(recuperados).toEqual([]);
      expect(productos.obtenerProducto).not.toHaveBeenCalled();
      expect(items()).toEqual([jasmine.objectContaining({ id: 9, quantity: 1 })]);
      expect(storedRecovered()).toEqual([8]);
      service.recuperarCarrito(8).subscribe(segunda => {
        expect(segunda).toEqual([]);
        expect(api.post).toHaveBeenCalledTimes(1);
        done();
      });
    });
  });

  it('preserves post-checkout additions when recovery repeats', (done) => {
    service.agregarProducto(producto9 as never, 1);
    api.post.and.returnValue(of({
      cart: { items: [{ productoId: 9, cantidad: 2 }] },
      ordenId: 8,
      recovered: true,
    }));
    productos.obtenerProducto.and.returnValue(of({ ...producto9 }));

    service.recuperarCarrito(8).subscribe(() => {
      expect(items()).toEqual([jasmine.objectContaining({ id: 9, quantity: 3 })]);
      service.recuperarCarrito(8).subscribe(() => {
        expect(items()).toEqual([jasmine.objectContaining({ id: 9, quantity: 3 })]);
        expect(api.post).toHaveBeenCalledTimes(1);
        done();
      });
    });
  });

  it('rejects invalid order ids without any HTTP call', (done) => {
    service.recuperarCarrito(NaN).subscribe({
      next: () => done.fail('debería fallar con orden inválida'),
      error: (error) => {
        expect(error.message).toBe('Orden inválida');
        expect(api.post).not.toHaveBeenCalled();
        done();
      },
    });
  });

  it('vaciarCarrito clears the pending pointer as well', () => {
    service.agregarProducto(producto9 as never, 1);
    localStorage.setItem('pumaplace.pending.v1.1', JSON.stringify({ ordenId: 5, userId: 1, items: [] }));
    service.vaciarCarrito();
    expect(items()).toEqual([]);
    expect(storedPending()).toBeNull();
  });
});
