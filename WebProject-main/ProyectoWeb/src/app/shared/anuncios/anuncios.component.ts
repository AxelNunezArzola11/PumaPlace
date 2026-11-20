import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { AnuncioService } from '../../services/anuncio.service';
import { Anuncio } from '../../models/anuncio.model';

@Component({
  selector: 'app-anuncios',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './anuncios.component.html',
  styleUrls: ['./anuncios.component.css'],
})
export class AnunciosComponent implements OnInit {
  anuncios: Anuncio[] = [];
  cargado = false;

  constructor(private readonly anuncioService: AnuncioService) {}

  ngOnInit(): void {
    this.anuncioService.listarActivos().subscribe({
      next: anuncios => {
        this.anuncios = anuncios;
        this.cargado = true;
      },
      error: () => {
        this.anuncios = [];
        this.cargado = true;
      },
    });
  }

  imagenSegura(url: string | undefined): string {
    return url || 'assets/images/PumaXpress.png';
  }

  onImageError(event: Event): void {
    const image = event.target as HTMLImageElement;
    if (image.src.endsWith('assets/images/PumaXpress.png')) return;
    image.src = 'assets/images/PumaXpress.png';
  }
}
