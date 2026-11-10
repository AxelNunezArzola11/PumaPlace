import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { PagoService } from '../../services/pago.service';

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

  constructor(
    private readonly route: ActivatedRoute,
    private readonly pagoService: PagoService,
  ) {}

  ngOnInit(): void {
    const ordenId = Number(this.route.snapshot.queryParamMap.get('ordenId'));
    if (!ordenId) {
      this.error = 'No se encontró la orden que se va a pagar.';
      return;
    }

    this.pagoService.crearPreferencia(ordenId).subscribe({
      next: preference => {
        const checkoutUrl = preference.sandbox_init_point || preference.init_point;
        if (!checkoutUrl) {
          this.error = 'Mercado Pago no devolvió una URL de checkout.';
          return;
        }
        this.estado = 'Abriendo Mercado Pago...';
        window.location.assign(checkoutUrl);
      },
      error: error => {
        this.error = error?.error?.message || 'No se pudo iniciar el procesamiento de pago.';
      },
    });
  }
}
