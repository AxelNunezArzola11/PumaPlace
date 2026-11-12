import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Orden } from '../../models/orden.model';
import { OrdenService } from '../../services/orden.service';

@Component({
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <section class="page">
      <a routerLink="/ordenes">Volver a mis órdenes</a>
      <p *ngIf="error">{{ error }}</p>
      <ng-container *ngIf="orden as current">
        <h1>Orden #{{ current.id }}</h1>
        <p>Estado: <strong>{{ current.estado }}</strong></p>
        <p>Total: {{ current.total | currency:'MXN' }}</p>
        <p>Método de pago: {{ current.metodoPago || 'Mercado Pago' }}</p>
        <p>Punto de entrega: {{ current.puntoEntrega || 'Por acordar' }}</p>
        <p *ngIf="current.fechaLimiteProcesamiento">Fecha límite: {{ current.fechaLimiteProcesamiento | date:'short' }}</p>
        <h2>Artículos</h2>
        <ul><li *ngFor="let item of current.lineas || []">
          Producto #{{ item.productoId }} · {{ item.cantidad }} · {{ item.precioUnitario | currency:'MXN' }}
        </li></ul>
        <h2>Historial</h2>
        <ul><li *ngFor="let change of current.statusHistory || [{ estado: current.estado }]">
          {{ change.estado }} <span *ngIf="change.fecha">· {{ change.fecha | date:'short' }}</span>
        </li></ul>
      </ng-container>
    </section>
  `,
})
export class OrdenDetalleComponent implements OnInit {
  orden?: Orden & { puntoEntrega?: string; lineas?: { productoId: number; cantidad: number; precioUnitario: number }[] };
  error = '';

  constructor(
    private readonly route: ActivatedRoute,
    private readonly ordenService: OrdenService,
  ) {}

  ngOnInit(): void {
    const id = Number(this.route.snapshot.paramMap.get('id'));
    this.ordenService.obtenerOrden(id).subscribe({
      next: (orden) => this.orden = orden as typeof this.orden,
      error: (error) => { this.error = error?.error?.message || 'No se pudo consultar la orden.'; },
    });
  }
}
