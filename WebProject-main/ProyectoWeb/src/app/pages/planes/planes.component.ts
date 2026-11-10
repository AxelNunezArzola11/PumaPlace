import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { ApiService } from '../../services/api.service';

@Component({
  standalone: true,
  imports: [CommonModule, RouterModule],
  template: `
    <section class="page">
      <h1>Planes Puma Place</h1>
      <div class="plans">
        <article><h2>Gratis</h2><p>Publica hasta 5 productos.</p><p>Comisión del 10% sólo al usar Mercado Pago.</p></article>
        <article class="premium-card">
          <h2>Premium</h2>
          <p>Publicaciones sin ese límite.</p>
          <p>$50 MXN al mes.</p>
          <button
            type="button"
            class="btn-premium"
            [disabled]="loading || submitted"
            (click)="activar()">
            {{ loading ? 'Activando...' : submitted ? 'Solicitud enviada' : 'Activar Premium' }}
          </button>
        </article>
      </div>
      <p *ngIf="message" class="plan-message" [class.error]="hasError">{{ message }}</p>
    </section>
  `,
  styles: [`
    .page {
      max-width: 920px;
      margin: 0 auto;
    }

    .plans {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
      gap: 1.5rem;
      margin-top: 1.5rem;
    }

    article {
      padding: 1.5rem;
      background: #fff;
      border: 1px solid #eadfc4;
      border-radius: 12px;
      box-shadow: 0 2px 10px rgba(93, 64, 55, 0.1);
    }

    .premium-card {
      border-color: #d2691e;
    }

    article h2 {
      margin-bottom: 0.75rem;
    }

    article p {
      margin: 0.35rem 0;
    }

    .btn-premium {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 170px;
      margin-top: 1rem;
      padding: 0.75rem 1.25rem;
      border: 0;
      border-radius: 8px;
      background: #d2691e;
      color: #fff;
      font: inherit;
      font-weight: 600;
      cursor: pointer;
      transition: background-color 0.2s ease, transform 0.2s ease;
    }

    .btn-premium:hover:not(:disabled) {
      background: #ad5316;
      transform: translateY(-1px);
    }

    .btn-premium:disabled {
      cursor: not-allowed;
      opacity: 0.65;
    }

    .plan-message {
      margin-top: 1rem;
      color: #287a3e;
      font-weight: 600;
    }

    .plan-message.error {
      color: #b42318;
    }
  `],
})
export class PlanesComponent {
  message = '';
  loading = false;
  submitted = false;
  hasError = false;

  constructor(private readonly api: ApiService) {}

  activar(): void {
    if (this.loading || this.submitted) return;

    this.loading = true;
    this.hasError = false;
    this.api.post('suscripciones/premium', {}).subscribe({
      next: () => {
        this.loading = false;
        this.submitted = true;
        this.message = 'Solicitud de activación enviada.';
      },
      error: error => {
        this.loading = false;
        this.hasError = true;
        this.message = error?.error?.message || error?.message || 'No se pudo activar Premium.';
      },
    });
  }
}
