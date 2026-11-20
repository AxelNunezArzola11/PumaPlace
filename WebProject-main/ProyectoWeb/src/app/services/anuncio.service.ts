import { Injectable } from '@angular/core';
import { Observable, catchError, map, of } from 'rxjs';
import { ApiService } from './api.service';
import { environment } from '../../environments/environment';
import { Anuncio } from '../models/anuncio.model';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/**
 * Mirrors the backend URL policy: HTTPS only, except http(s) localhost
 * URLs while developing locally (`allowLocalhost`). URLs with embedded
 * credentials are always rejected. Exported for unit tests.
 */
export function isSafeAdUrl(value: unknown, allowLocalhost: boolean): boolean {
  if (typeof value !== 'string') return false;
  const text = value.trim();
  if (text === '') return false;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return false;
  }
  if (url.username !== '' || url.password !== '') return false;
  if (url.protocol === 'https:') return true;
  return allowLocalhost && url.protocol === 'http:'
    && LOCAL_HOSTS.has(url.hostname.toLowerCase());
}

/** Full client-side record check: only render complete, safe ads. */
export function isValidAnuncio(value: unknown, allowLocalhost: boolean): value is Anuncio {
  if (!value || typeof value !== 'object') return false;
  const ad = value as Partial<Anuncio>;
  const id = Number(ad.id);
  return Number.isSafeInteger(id) && id > 0
    && typeof ad.title === 'string' && ad.title.trim() !== ''
    && typeof ad.advertiser === 'string' && ad.advertiser.trim() !== ''
    && isSafeAdUrl(ad.imageUrl, allowLocalhost)
    && isSafeAdUrl(ad.targetUrl, allowLocalhost);
}

/**
 * Storefront advertisement integration (backend contract:
 * `GET /api/anuncios/activos` → public `Anuncio[]`).
 *
 * Every record is validated before it reaches the template, and any API
 * failure resolves to an empty list so the catalog never breaks. An empty
 * response renders nothing: ads are never placeholders.
 */
@Injectable({ providedIn: 'root' })
export class AnuncioService {
  constructor(private readonly api: ApiService) {}

  listarActivos(): Observable<Anuncio[]> {
    if (!environment.advertisementsEnabled) return of([]);
    const allowLocalhost = !environment.production;
    return this.api.get<Anuncio[]>('anuncios/activos').pipe(
      map(anuncios => (Array.isArray(anuncios) ? anuncios : [])
        .filter(anuncio => isValidAnuncio(anuncio, allowLocalhost))),
      catchError(() => of([])),
    );
  }
}
