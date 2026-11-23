import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { PagoService } from '../../services/pago.service';

const CHECKOUT_HOST =
  /^(.*\.)?mercadopago\.com(\.[a-z]{2})?$|^(.*\.)?mercadolibre\.com(\.[a-z]{2})?$/;

/**
 * Checkout Pro entry page: creates the preference server-side, validates the
 * returned URL, and performs a full-page navigation to Mercado Pago.
 *
 * No popup, no iframe, no polling here: after navigation this page unloads
 * and the return pages (retorno-pago) verify the backend order state.
 * Redirecting is never reported as a successful payment.
 */
@Component({
  selector: 'app-pago',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './pago.component.html',
  styleUrls: ['./pago.component.css']
})
export class PagoComponent implements OnInit {
  estado = 'Preparando el procesamiento de pago...';
  error = '';
  ordenId = 0;
  preferenciaFallida = false;

  constructor(
    private readonly route: ActivatedRoute,
    private readonly pagoService: PagoService,
  ) {}

  ngOnInit(): void {
    this.ordenId = Number(this.route.snapshot.queryParamMap.get('ordenId'));
    if (!this.ordenId) {
      this.error = 'No se encontró la orden que se va a pagar.';
      return;
    }

    this.solicitarPreferencia();
  }

  solicitarPreferencia(): void {
    this.error = '';
    this.preferenciaFallida = false;
    this.estado = 'Preparando el procesamiento de pago...';
    this.pagoService.crearPreferencia(this.ordenId).subscribe({
      next: preference => {
        const url = preference.checkoutUrl
          || preference.sandbox_init_point
          || preference.init_point
          || '';
        if (!this.esCheckoutValido(url)) {
          this.preferenciaFallida = true;
          this.error = 'Mercado Pago no devolvió una URL de checkout válida. Reintenta en unos momentos.';
          return;
        }
        this.estado = 'Redirigiendo a Mercado Pago...';
        this.navegar(url);
      },
      error: error => {
        this.preferenciaFallida = true;
        this.error = this.mensajeParaErrorPreferencia(error);
      },
    });
  }

  esCheckoutValido(url: string): boolean {
    if (!url) return false;
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'https:' && CHECKOUT_HOST.test(parsed.hostname.toLowerCase());
    } catch {
      return false;
    }
  }

  navegar(url: string): void {
    window.location.href = url;
  }

  mensajeParaErrorPreferencia(error: unknown): string {
    const status = (error as { status?: number } | null)?.status;
    const backend = (error as { error?: { message?: string } } | null)?.error?.message;
    if (status === 0) return 'Sin conexión con el servidor. Revisa tu internet y reintenta.';
    if (status === 410) return 'La reserva de esta orden expiró. Crea una nueva orden desde el carrito.';
    if (status === 422) return backend || 'Esta orden ya no admite pagos. Revisa su estado en Órdenes.';
    if (status === 404) return 'La orden ya no existe.';
    if (status === 403) return 'No tienes permiso para pagar esta orden.';
    if (status === 429) return 'Demasiados intentos. Espera unos minutos y reintenta.';
    return backend || 'No se pudo iniciar el procesamiento de pago.';
  }
}
