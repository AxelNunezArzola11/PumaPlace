import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { ApiService } from '../../services/api.service';
import { Orden } from '../../models/orden.model';

export type FiltroOrden = 'todas' | 'pendiente' | 'pagada' | 'cancelada';

const ABIERTAS = ['pendiente', 'procesando'];

@Component({
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './ordenes.component.html',
  styleUrls: ['./ordenes.component.css'],
})
export class OrdenesComponent implements OnInit {
  ordenes: Orden[] = [];
  cargando = true;
  error = '';
  filtro: FiltroOrden = 'todas';

  constructor(private readonly api: ApiService) {}

  ngOnInit(): void {
    this.cargar();
  }

  cargar(): void {
    this.cargando = true;
    this.error = '';
    this.api.get<Orden[]>('ordenes').subscribe({
      next: ordenes => {
        this.ordenes = ordenes ?? [];
        this.cargando = false;
      },
      error: () => {
        this.cargando = false;
        this.error = 'No pudimos cargar tus órdenes. Revisa tu conexión e inténtalo de nuevo.';
      },
    });
  }

  visibles(): Orden[] {
    if (this.filtro === 'todas') return this.ordenes;
    if (this.filtro === 'pendiente') return this.ordenes.filter(o => ABIERTAS.includes(o.estado));
    return this.ordenes.filter(o => o.estado === this.filtro);
  }

  claseEstado(estado: string): string {
    if (estado === 'pagada' || estado === 'completada') return 'ok';
    if (ABIERTAS.includes(estado)) return 'pendiente';
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

  calcularTotal(orden: Orden): number {
    const lineas = orden.lineas ?? [];
    const subtotal = lineas.reduce(
      (sum, linea) => sum + Number(linea.precioUnitario) * Number(linea.cantidad),
      0,
    );
    return subtotal - Number((orden as { descuento?: number }).descuento ?? 0);
  }

  fechaOrden(orden: Orden): string | undefined {
    const o = orden as unknown as { fechaCreacion?: string; createdAt?: string };
    return o.fechaCreacion ?? o.createdAt ?? undefined;
  }
}
