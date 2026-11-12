import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { ApiService } from '../../services/api.service';
import { Orden } from '../../models/orden.model';

@Component({
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <section class="page"><h1>Mis órdenes</h1>
      <p *ngIf="!ordenes.length">Aún no tienes órdenes.</p>
      <article *ngFor="let orden of ordenes">
        <a [routerLink]="['/ordenes', orden.id]">Orden #{{ orden.id }}</a>
        <span>{{ orden.estado }}</span>
        <span>Total: {{ orden.total | currency:'MXN' }}</span>
        <small *ngIf="orden.fechaLimiteProcesamiento">
          Procesar antes de: {{ orden.fechaLimiteProcesamiento | date:'short' }}
        </small>
      </article>
    </section>
  `,
})
export class OrdenesComponent implements OnInit {
  ordenes: Orden[] = [];
  constructor(private readonly api: ApiService) {}
  ngOnInit(): void {
    this.api.get<Orden[]>('ordenes').subscribe({ next: ordenes => this.ordenes = ordenes });
  }
}
