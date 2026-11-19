import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { of, throwError } from 'rxjs';

import { PagoComponent } from './pago.component';
import { PagoService } from '../../services/pago.service';

describe('PagoComponent', () => {
  let component: PagoComponent;
  let fixture: ComponentFixture<PagoComponent>;
  let pagoService: jasmine.SpyObj<PagoService>;

  async function create(preferencia$: unknown, ordenIdParam: string | null = '5') {
    pagoService = jasmine.createSpyObj('PagoService', ['crearPreferencia']);
    pagoService.crearPreferencia.and.returnValue(preferencia$ as never);

    await TestBed.configureTestingModule({
      imports: [PagoComponent],
      providers: [
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { queryParamMap: new Map([['ordenId', ordenIdParam]]) } },
        },
        { provide: PagoService, useValue: pagoService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(PagoComponent);
    component = fixture.componentInstance;
    spyOn(component, 'navegar');
    fixture.detectChanges();
  }

  afterEach(() => {
    fixture?.destroy();
  });

  it('should create', async () => {
    await create(of({ checkoutUrl: 'https://sandbox.mercadopago.com/pay?pref_id=1' }));
    expect(component).toBeTruthy();
  });

  it('navigates top-level to the server-selected checkout URL', async () => {
    await create(of({ checkoutUrl: 'https://www.mercadopago.com.mx/checkout/start?pref_id=1' }));
    expect(component.navegar).toHaveBeenCalledWith(
      'https://www.mercadopago.com.mx/checkout/start?pref_id=1',
    );
    expect(component.error).toBe('');
  });

  it('rejects missing checkout URLs with a retryable error', async () => {
    await create(of({}));
    expect(component.navegar).not.toHaveBeenCalled();
    expect(component.preferenciaFallida).toBeTrue();
    expect(component.error).toContain('URL de checkout válida');
  });

  it('rejects non-HTTPS and off-domain checkout URLs', async () => {
    await create(of({}));
    for (const bad of [
      'http://www.mercadopago.com.mx/checkout/start?pref_id=1',
      'https://evil.example/checkout',
      'https://mercadopago.com.evil.example/pay',
      'not-a-url',
    ]) {
      expect(component.esCheckoutValido(bad)).toBeFalse();
    }
    expect(component.esCheckoutValido('https://sandbox.mercadopago.com/pay?pref_id=1')).toBeTrue();
    expect(component.esCheckoutValido('https://www.mercadopago.com.mx/checkout/start?pref_id=1')).toBeTrue();
  });

  it('maps an expired reservation (410) to a retryable message', async () => {
    await create(throwError(() => ({ status: 410, error: { message: 'La reserva expiró' } })));
    expect(component.navegar).not.toHaveBeenCalled();
    expect(component.preferenciaFallida).toBeTrue();
    expect(component.error).toContain('expiró');
  });

  it('maps a network failure (status 0) to a retryable message', async () => {
    await create(throwError(() => ({ status: 0 })));
    expect(component.preferenciaFallida).toBeTrue();
    expect(component.error).toContain('Sin conexión');
  });

  it('retries the preference request on demand', async () => {
    await create(throwError(() => ({ status: 500, error: { message: 'MP down' } })));
    expect(component.preferenciaFallida).toBeTrue();
    pagoService.crearPreferencia.and.returnValue(
      of({ checkoutUrl: 'https://sandbox.mercadopago.com/pay?pref_id=1' }) as never,
    );
    component.solicitarPreferencia();
    expect(pagoService.crearPreferencia).toHaveBeenCalledTimes(2);
    expect(component.preferenciaFallida).toBeFalse();
    expect(component.navegar).toHaveBeenCalledTimes(1);
  });

  it('reports a missing order without calling the backend', async () => {
    await create(of({}), null);
    expect(component.error).toContain('No se encontró la orden');
    expect(pagoService.crearPreferencia).not.toHaveBeenCalled();
  });
});
