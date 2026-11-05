import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ApiService } from '../../services/api.service';

interface Notificacion { id: number; mensaje?: string; contenido?: string; enviada?: boolean; }

@Component({
  standalone: true,
  imports: [CommonModule],
  template: `
    <section class="page"><h1>Notificaciones</h1>
      <p *ngIf="!notificaciones.length">No tienes notificaciones.</p>
      <article *ngFor="let notificacion of notificaciones">
        {{ notificacion.mensaje || notificacion.contenido }}
      </article>
    </section>
  `,
})
export class NotificacionesComponent implements OnInit {
  notificaciones: Notificacion[] = [];
  constructor(private readonly api: ApiService) {}
  ngOnInit(): void {
    this.api.get<Notificacion[]>('notificaciones').subscribe({ next: items => this.notificaciones = items });
  }
}
