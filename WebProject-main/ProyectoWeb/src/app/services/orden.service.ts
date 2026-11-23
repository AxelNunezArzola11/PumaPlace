import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';
import { Orden } from '../models/orden.model';

@Injectable({ providedIn: 'root' })
export class OrdenService {
  constructor(private readonly api: ApiService) {}
  obtenerOrdenes(): Observable<Orden[]> { return this.api.get<Orden[]>('ordenes'); }
  obtenerOrden(id: number): Observable<Orden> { return this.api.get<Orden>(`ordenes/${id}`); }
  crearOrden(puntoEntrega: string, descuento = 0): Observable<Orden> {
    return this.api.post<Orden>('ordenes', { puntoEntrega, descuento });
  }
  actualizarPuntoEntrega(id: number, puntoEntrega: string): Observable<Orden> {
    return this.api.patch<Orden>(`ordenes/${id}`, { puntoEntrega });
  }
}
