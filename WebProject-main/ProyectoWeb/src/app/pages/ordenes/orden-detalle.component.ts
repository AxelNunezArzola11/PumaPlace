import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Orden } from '../../models/orden.model';
import { OrdenService } from '../../services/orden.service';

type Linea = { productoId: number; cantidad: number; precioUnitario: number };

@Component({
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './orden-detalle.component.html',
  styleUrls: ['./orden-detalle.component.css'],
})
export class OrdenDetalleComponent implements OnInit {
  orden?: Orden & { puntoEntrega?: string; lineas?: Linea[] };
  cargando = true;
  error = '';

  constructor(
    private readonly route: ActivatedRoute,
    private readonly ordenService: OrdenService,
  ) {}

  ngOnInit(): void {
    const id = Number(this.route.snapshot.paramMap.get('id'));
    if (!id) {
      this.cargando = false;
      this.error = 'No se encontró la orden solicitada.';
      return;
    }
    this.ordenService.obtenerOrden(id).subscribe({
      next: (orden) => {
        this.orden = orden as typeof this.orden;
        this.cargando = false;
      },
      error: (error) => {
        this.cargando = false;
        this.error = error?.error?.message || 'No se pudo consultar la orden.';
      },
    });
  }

  claseEstado(estado: string): string {
    if (estado === 'pagada' || estado === 'completada') return 'ok';
    if (estado === 'pendiente' || estado === 'procesando') return 'pendiente';
    if (estado === 'cancelada') return 'cancelada';
    return 'neutral';
  }

  etiquetaEstado(estado: string): string {
    if (estado === 'pagada') return 'Pagada';
    if (estado === 'pendiente' || estado === 'procesando') return 'Pendiente';
    if (estado === 'cancelada') return 'Cancelada';
    if (estado === 'completada') return 'Completada';
    return estado;
  }

  calcularTotal(): number {
    const lineas = this.orden?.lineas ?? [];
    const subtotal = lineas.reduce(
      (sum, linea) => sum + Number(linea.precioUnitario) * Number(linea.cantidad),
      0,
    );
    return subtotal - Number((this.orden as { descuento?: number })?.descuento ?? 0);
  }

  subtotalLinea(linea: Linea): number {
    return Number(linea.precioUnitario) * Number(linea.cantidad);
  }

  fechaOrden(): string | undefined {
    const o = this.orden as unknown as { fechaCreacion?: string; createdAt?: string } | undefined;
    return o?.fechaCreacion ?? o?.createdAt ?? undefined;
  }
}
