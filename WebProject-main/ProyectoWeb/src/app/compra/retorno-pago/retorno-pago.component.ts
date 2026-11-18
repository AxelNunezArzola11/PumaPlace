import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Subscription, timer } from 'rxjs';
import { switchMap, takeWhile } from 'rxjs/operators';
import { OrdenService } from '../../services/orden.service';

const TERMINAL_STATES = ['pagada', 'cancelada', 'fallida', 'expirada'];

const HINTS: Record<string, string> = {
  exito: 'Mercado Pago te devolvió por la ruta de éxito.',
  fallo: 'Mercado Pago te devolvió por la ruta de fallo.',
  pendiente: 'Mercado Pago te devolvió por la ruta de pago pendiente.',
};

/**
 * Mercado Pago return pages (MP_BACK_URL_*). They NEVER trust the return-URL
 * parameters (collection_status, etc.): those are only a hint. The verdict
 * shown here always comes from polling the backend order status, which is
 * only updated through the verified webhook.
 */
@Component({
  selector: 'app-retorno-pago',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './retorno-pago.component.html',
})
export class RetornoPagoComponent implements OnInit, OnDestroy {
  hint = '';
  estado = 'Verificando el estado real de tu orden con el backend…';
  error = '';
  resultado = '';
  ordenId = 0;
  private polling?: Subscription;

  constructor(
    private readonly route: ActivatedRoute,
    private readonly ordenService: OrdenService,
  ) {}

  ngOnInit(): void {
    const kind = this.route.snapshot.data['resultado'] ?? 'pendiente';
    this.hint = `${HINTS[kind] ?? ''} El resultado mostrado aquí viene del backend, no de los parámetros de retorno.`;
    // Mercado Pago appends external_reference (= our orden id) to back_urls.
    this.ordenId = Number(
      this.route.snapshot.queryParamMap.get('external_reference')
        ?? this.route.snapshot.queryParamMap.get('ordenId'),
    );
    if (!this.ordenId) {
      this.error = 'No se encontró la orden en la URL de retorno.';
      return;
    }
    this.iniciarPolling();
  }

  private iniciarPolling(): void {
    this.polling?.unsubscribe();
    this.polling = timer(0, 4000).pipe(
      switchMap(() => this.ordenService.obtenerOrden(this.ordenId)),
      takeWhile((orden) => !TERMINAL_STATES.includes(orden.estado), true),
    ).subscribe({
      next: (orden) => {
        if (TERMINAL_STATES.includes(orden.estado)) {
          this.estado = '';
          this.resultado = orden.estado === 'pagada'
            ? 'Pago confirmado por el backend. Tu orden está pagada.'
            : 'El backend reporta que el pago no fue aprobado. Puedes reintentar.';
        }
      },
      error: () => { this.error = 'No se pudo consultar el estado de la orden.'; },
    });
    window.setTimeout(() => {
      if (!this.resultado && !this.error) {
        this.polling?.unsubscribe();
        this.resultado = 'Se agotó el tiempo de espera. Revisa el estado de la orden o reintenta el pago.';
      }
    }, 5 * 60 * 1000);
  }

  ngOnDestroy(): void {
    this.polling?.unsubscribe();
  }
}
