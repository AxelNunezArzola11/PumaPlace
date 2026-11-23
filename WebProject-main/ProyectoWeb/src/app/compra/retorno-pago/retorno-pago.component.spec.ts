import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { of, throwError } from 'rxjs';

import { RetornoPagoComponent } from './retorno-pago.component';
import { OrdenService } from '../../services/orden.service';
import { CarritoService } from '../../services/carrito.service';

describe('RetornoPagoComponent', () => {
  let component: RetornoPagoComponent;
  let fixture: ComponentFixture<RetornoPagoComponent>;
  let ordenService: jasmine.SpyObj<OrdenService>;
  let carritoService: jasmine.SpyObj<CarritoService>;
  let navigateSpy: jasmine.Spy;

  async function create(query: Record<string, string | null>, orden$: unknown) {
    ordenService = jasmine.createSpyObj('OrdenService', ['obtenerOrden']);
    ordenService.obtenerOrden.and.returnValue(orden$ as never);
    carritoService = jasmine.createSpyObj('CarritoService', [
      'reconciliarTrasPago', 'tieneArticulos', 'recuperarCarrito', 'procesarCompra',
    ]);
    carritoService.reconciliarTrasPago.and.returnValue(of({ reconciliado: true }));

    await TestBed.configureTestingModule({
      imports: [RetornoPagoComponent, RouterTestingModule],
      providers: [
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              data: { resultado: 'exito' },
              queryParamMap: new Map(Object.entries(query).filter(([, value]) => value !== null)),
            },
          },
        },
        { provide: OrdenService, useValue: ordenService },
        { provide: CarritoService, useValue: carritoService },
      ],
    }).compileComponents();

    navigateSpy = spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(true);
    fixture = TestBed.createComponent(RetornoPagoComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  afterEach(() => {
    fixture?.destroy();
  });

  it('shows paid only on backend-confirmed orders and reconciles the cart', async () => {
    await create({ external_reference: '8' }, of({ id: 8, estado: 'pagada', lineas: [] }));
    expect(component.vista).toBe('pagada');
    expect(component.ordenId).toBe(8);
    expect(carritoService.reconciliarTrasPago).toHaveBeenCalledWith(8);
  });

  it('shows cancelled for backend-cancelled orders without reconciling', async () => {
    await create({ ordenId: '8' }, of({ id: 8, estado: 'cancelada', lineas: [] }));
    expect(component.vista).toBe('cancelada');
    expect(carritoService.reconciliarTrasPago).not.toHaveBeenCalled();
  });

  it('keeps pending orders in a waiting state', async () => {
    await create({ ordenId: '8' }, of({ id: 8, estado: 'pendiente', lineas: [] }));
    expect(component.vista).toBe('pendiente');
    expect(carritoService.reconciliarTrasPago).not.toHaveBeenCalled();
  });

  it('shows a verification error when the backend cannot be reached', async () => {
    await create({ ordenId: '8' }, throwError(() => ({ status: 0 })));
    expect(component.vista).toBe('error');
  });

  it('explains unidentified orders without calling the backend', async () => {
    await create({}, of({}));
    expect(component.vista).toBe('sin-orden');
    expect(ordenService.obtenerOrden).not.toHaveBeenCalled();
  });

  it('retries from the local cart when it still has items', async () => {
    await create({ ordenId: '8' }, of({ id: 8, estado: 'cancelada', lineas: [] }));
    carritoService.tieneArticulos.and.returnValue(true);
    carritoService.procesarCompra.and.returnValue(of({ success: true, orden: { id: 9 } as never }));
    component.reintentarCompra();
    expect(carritoService.recuperarCarrito).not.toHaveBeenCalled();
    expect(carritoService.procesarCompra).toHaveBeenCalled();
    expect(navigateSpy).toHaveBeenCalledWith(['/pago'], { queryParams: { ordenId: 9 } });
  });

  it('recovers the cart first when local items were lost', async () => {
    await create({ ordenId: '8' }, of({ id: 8, estado: 'cancelada', lineas: [] }));
    carritoService.tieneArticulos.and.returnValue(false);
    carritoService.recuperarCarrito.and.returnValue(of([]));
    carritoService.procesarCompra.and.returnValue(of({ success: true, orden: { id: 9 } as never }));
    component.reintentarCompra();
    expect(carritoService.recuperarCarrito).toHaveBeenCalledWith(8);
    expect(navigateSpy).toHaveBeenCalledWith(['/pago'], { queryParams: { ordenId: 9 } });
  });
});
