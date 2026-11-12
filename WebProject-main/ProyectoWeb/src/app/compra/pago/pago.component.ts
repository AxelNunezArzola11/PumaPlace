import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { PagoService } from '../../services/pago.service';
import { OrdenService } from '../../services/orden.service';
import { Subscription, timer } from 'rxjs';
import { switchMap, takeWhile } from 'rxjs/operators';

@Component({
  selector: 'app-pago',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './pago.component.html',
  styleUrls: ['./pago.component.css']
})
export class PagoComponent implements OnInit, OnDestroy {
  estado = 'Preparando el procesamiento de pago...';
  error = '';
  ordenId = 0;
  checkoutUrl = '';
  esperandoConfirmacion = false;
  popupBloqueado = false;
  resultado = '';
  private popup: Window | null = null;
  private polling?: Subscription;

  constructor(
    private readonly route: ActivatedRoute,
    private readonly pagoService: PagoService,
    private readonly ordenService: OrdenService,
  ) {}

  ngOnInit(): void {
    this.ordenId = Number(this.route.snapshot.queryParamMap.get('ordenId'));
    if (!this.ordenId) {
      this.error = 'No se encontró la orden que se va a pagar.';
      return;
    }

    this.pagoService.crearPreferencia(this.ordenId).subscribe({
      next: preference => {
        this.checkoutUrl = preference.sandbox_init_point || preference.init_point || '';
        if (!this.checkoutUrl) {
          this.error = 'Mercado Pago no devolvió una URL de checkout.';
          return;
        }
        this.estado = 'Listo para abrir Mercado Pago.';
        this.abrirCheckout();
      },
      error: error => {
        this.error = error?.error?.message || 'No se pudo iniciar el procesamiento de pago.';
      },
    });
  }

  abrirCheckout(): void {
    if (!this.checkoutUrl) return;
    this.popup = window.open(this.checkoutUrl, 'puma-place-checkout', 'popup,width=520,height=760');
    if (!this.popup) {
      this.popupBloqueado = true;
      this.error = 'El navegador bloqueó la ventana de Mercado Pago. Permite ventanas emergentes y reintenta.';
      return;
    }
    this.popupBloqueado = false;
    this.esperandoConfirmacion = true;
    this.estado = 'Esperando confirmación del pago...';
    this.iniciarPolling();
  }

  private iniciarPolling(): void {
    this.polling?.unsubscribe();
    this.polling = timer(0, 4000).pipe(
      switchMap(() => this.ordenService.obtenerOrden(this.ordenId)),
      takeWhile((orden) => !['pagada', 'cancelada', 'fallida', 'expirada'].includes(orden.estado), true),
    ).subscribe({
      next: (orden) => {
        if (['pagada', 'cancelada', 'fallida', 'expirada'].includes(orden.estado)) {
          this.esperandoConfirmacion = false;
          this.resultado = orden.estado === 'pagada'
            ? 'Pago confirmado. Tu orden está pagada.'
            : 'El pago no fue aprobado. Puedes reintentar.';
          this.popup?.close();
        }
      },
      error: () => { this.error = 'No se pudo consultar el estado de la orden.'; },
    });
    window.setTimeout(() => {
      if (this.esperandoConfirmacion) {
        this.polling?.unsubscribe();
        this.esperandoConfirmacion = false;
        this.resultado = 'Se agotó el tiempo de espera. Revisa el estado de la orden o reintenta el pago.';
      }
    }, 5 * 60 * 1000);
  }

  reintentar(): void {
    this.error = '';
    this.resultado = '';
    this.abrirCheckout();
  }

  ngOnDestroy(): void {
    this.polling?.unsubscribe();
    this.popup?.close();
  }
}
