import { Injectable } from '@angular/core';
import { Observable, catchError, map, of } from 'rxjs';
import { ApiService } from './api.service';
import { environment } from '../../environments/environment';
import { Anuncio } from '../models/anuncio.model';

/**
 * Punto de integración de publicidad.
 *
 * Contrato documentado (backend pendiente): `GET /api/anuncios/activos`
 * debe devolver `Anuncio[]` con anuncios vigentes (`activo !== false`).
 * Mientras `environment.advertisementsEnabled` sea false (valor actual:
 * no existe fuente backend), NO se hace ninguna petición HTTP y se
 * devuelve lista vacía. Los anuncios nunca son placeholders: solo se
 * renderiza lo que venga de datos reales.
 */
@Injectable({ providedIn: 'root' })
export class AnuncioService {
  constructor(private readonly api: ApiService) {}

  listarActivos(): Observable<Anuncio[]> {
    if (!environment.advertisementsEnabled) return of([]);
    return this.api.get<Anuncio[]>('anuncios/activos').pipe(
      map(anuncios => (Array.isArray(anuncios) ? anuncios : []).filter(anuncio => {
        // Number(null) === 0 passes isSafeInteger, so ids must be positive.
        const id = Number(anuncio?.id);
        const productoId = Number(anuncio?.productoId);
        return Number.isSafeInteger(id) && id > 0
          && typeof anuncio?.titulo === 'string' && anuncio.titulo.trim() !== ''
          && Number.isSafeInteger(productoId) && productoId > 0
          && anuncio?.activo !== false;
      })),
      catchError(() => of([])),
    );
  }
}
