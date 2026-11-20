import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AnuncioService } from '../../services/anuncio.service';
import { Anuncio } from '../../models/anuncio.model';

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

  onImageError(event: Event): void {
    const image = event.target as HTMLImageElement;
    if (image.src.endsWith('assets/images/PumaXpress.png')) return;
    image.src = 'assets/images/PumaXpress.png';
  }
}
