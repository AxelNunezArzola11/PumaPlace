import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';
import { Pago, MetodoPago } from '../models/pago.model';

export interface PreferenciaPago { init_point?: string; sandbox_init_point?: string; [key: string]: unknown; }

@Injectable({ providedIn: 'root' })
export class PagoService {
  constructor(private readonly api: ApiService) {}
  obtenerPagos(): Observable<Pago[]> { return this.api.get<Pago[]>('pagos'); }
  obtenerPago(id: number): Observable<Pago> { return this.api.get<Pago>(`pagos/${id}`); }
  obtenerPagosPorOrden(ordenId: number): Observable<Pago[]> { return this.api.get<Pago[]>('pagos', { ordenId }); }
  crearPreferencia(ordenId: number): Observable<PreferenciaPago> {
    return this.api.post<PreferenciaPago>('pagos/preferencia', { ordenId });
  }
  procesarPago(ordenId: number, _monto: number, metodoPago: MetodoPago): Observable<Pago> {
    return this.api.post<Pago>('pagos', { ordenId, metodoPago });
  }
  confirmarPago(ordenId: number): Observable<Pago> {
    return this.api.post<Pago>(`pagos/${ordenId}/confirmar`, {});
  }
}
