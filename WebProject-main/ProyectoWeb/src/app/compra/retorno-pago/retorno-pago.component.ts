import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Subscription, timer } from 'rxjs';
import { switchMap, takeWhile } from 'rxjs/operators';
import { OrdenService } from '../../services/orden.service';
import { CarritoService } from '../../services/carrito.service';
import { Orden } from '../../models/orden.model';

const TERMINAL_STATES = ['pagada', 'cancelada', 'fallida', 'expirada'];

type Vista = 'verificando' | 'pagada' | 'pendiente' | 'cancelada' | 'error' | 'sin-orden';

/**
 * Mercado Pago return pages (MP_BACK_URL_*). They NEVER trust the return-URL
 * parameters (collection_status, etc.): the verdict shown here always comes
 * from polling the backend order status, which is only updated through the
 * verified webhook. Displays ONLY the order of the current payment attempt.
 */
@Component({
  selector: 'app-retorno-pago',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './retorno-pago.component.html',
  styleUrls: ['./retorno-pago.component.css'],
})
export class RetornoPagoComponent implements OnInit, OnDestroy {
  vista: Vista = 'verificando';
  estado = 'Verificando el estado real de tu pago…';
  error = '';
  ordenId = 0;
  orden?: Orden;
  reintentando = false;
  errorReintento = '';
  private polling?: Subscription;

  constructor(
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly ordenService: OrdenService,
    private readonly carritoService: CarritoService,
  ) {}

  ngOnInit(): void {
    // Mercado Pago appends external_reference (= our orden id) to back_urls.
    this.ordenId = Number(
      this.route.snapshot.queryParamMap.get('external_reference')
        ?? this.route.snapshot.queryParamMap.get('ordenId'),
    );
    if (!this.ordenId) {
      this.vista = 'sin-orden';
      this.error = 'No pudimos identificar tu orden desde el enlace de retorno.';
      return;
    }
    this.iniciarPolling();
  }

  calcularTotal(): number {
    const lineas = this.orden?.lineas ?? [];
    const subtotal = lineas.reduce(
      (sum, linea) => sum + Number(linea.precioUnitario) * Number(linea.cantidad),
      0,
    );
    return subtotal - Number((this.orden as { descuento?: number })?.descuento ?? 0);
  }

  fechaOrden(): string | undefined {
    const orden = this.orden as { fechaCreacion?: string; createdAt?: string } | undefined;
    return orden?.fechaCreacion ?? orden?.createdAt ?? undefined;
  }

  reintentarCompra(): void {
    if (this.reintentando) return;
    this.reintentando = true;
    this.errorReintento = '';
    const continuar = () => this.carritoService.procesarCompra().subscribe({
      next: (respuesta) => {
        this.reintentando = false;
        const nuevoId = respuesta.orden?.id;
        if (nuevoId) {
          void this.router.navigate(['/pago'], { queryParams: { ordenId: nuevoId } });
        } else {
          this.errorReintento = 'No se pudo crear la nueva orden. Inténtalo desde el carrito.';
        }
      },
      error: (error) => {
        this.reintentando = false;
        this.errorReintento = error?.message || 'No se pudo reintentar la compra. Inténtalo desde el carrito.';
      },
    });
    // Si el carrito local se perdió (otro dispositivo, limpieza del navegador),
    // primero se restaura desde la orden cancelada y luego se reintenta.
    if (!this.carritoService.tieneArticulos()) {
      this.carritoService.recuperarCarrito(this.ordenId).subscribe({
        next: () => continuar(),
        error: () => {
          this.reintentando = false;
          this.errorReintento = 'No pudimos recuperar tu carrito. Agrega los productos de nuevo.';
        },
      });
    } else {
      continuar();
    }
  }

  private iniciarPolling(): void {
    this.polling?.unsubscribe();
    this.polling = timer(0, 4000).pipe(
      switchMap(() => this.ordenService.obtenerOrden(this.ordenId)),
      takeWhile((orden) => !TERMINAL_STATES.includes(orden.estado), true),
    ).subscribe({
      next: (orden) => {
        this.orden = orden;
        if (orden.estado === 'pagada') {
          this.vista = 'pagada';
          this.estado = '';
          // Concilia el carrito local SOLO con pago confirmado por backend.
          this.carritoService.reconciliarTrasPago(this.ordenId).subscribe();
        } else if (TERMINAL_STATES.includes(orden.estado)) {
          this.vista = 'cancelada';
          this.estado = '';
        } else {
          this.vista = 'pendiente';
        }
      },
      error: () => {
        this.polling?.unsubscribe();
        this.vista = 'error';
        this.error = 'No pudimos verificar tu pago. Revisa tu conexión e inténtalo de nuevo.';
      },
    });
    window.setTimeout(() => {
      if (this.vista === 'verificando' || this.vista === 'pendiente') {
        this.polling?.unsubscribe();
        // Sin veredicto a tiempo: se muestra como pendiente, nunca como pagada.
        this.vista = 'pendiente';
      }
    }, 5 * 60 * 1000);
  }

  ngOnDestroy(): void {
    this.polling?.unsubscribe();
  }
}
