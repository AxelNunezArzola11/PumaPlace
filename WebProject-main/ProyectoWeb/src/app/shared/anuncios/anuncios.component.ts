import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AnuncioService } from '../../services/anuncio.service';
import { Anuncio } from '../../models/anuncio.model';

/**
 * True when the ad destination lives on another host than the storefront.
 * Pure (host injected) so unit tests stay deterministic. Exported for tests.
 */
export function isExternalUrl(targetUrl: unknown, currentHost: string): boolean {
  if (typeof targetUrl !== 'string') return false;
  try {
    const host = new URL(targetUrl).hostname.toLowerCase();
    return host !== '' && host !== currentHost.toLowerCase();
  } catch {
    return false;
  }
}

@Component({
  selector: 'app-anuncios',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './anuncios.component.html',
  styleUrls: ['./anuncios.component.css'],
})
export class AnunciosComponent implements OnInit {
  anuncios: Anuncio[] = [];
  cargando = true;
  error = false;

  constructor(private readonly anuncioService: AnuncioService) {}

  ngOnInit(): void {
    this.anuncioService.listarActivos().subscribe({
      next: anuncios => {
        // Empty responses render nothing: ads are never placeholders.
        this.anuncios = anuncios;
        this.cargando = false;
        this.error = false;
      },
      error: () => {
        // An API failure shows one inline notice and never breaks the catalog.
        this.anuncios = [];
        this.cargando = false;
        this.error = true;
      },
    });
  }

  /** Visible "ENLACE EXTERNO" badge + noreferrer apply to off-site targets only. */
  esExterno(anuncio: Anuncio): boolean {
    try {
      const currentHost = typeof window !== 'undefined' && window.location
        ? window.location.hostname
        : '';
      return isExternalUrl(anuncio?.targetUrl, currentHost);
    } catch {
      return false;
    }
  }

  onImageError(event: Event): void {
    const image = event.target as HTMLImageElement;
    if (image.src.endsWith('assets/images/PumaXpress.png')) return;
    image.src = 'assets/images/PumaXpress.png';
  }
}
