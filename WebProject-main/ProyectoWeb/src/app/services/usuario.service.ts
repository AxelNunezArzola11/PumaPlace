import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';
import { Usuario } from '../models/usuario.model';
export type ListaUsuario = Usuario;

@Injectable({ providedIn: 'root' })
export class UsuarioService {
  constructor(private readonly api: ApiService) {}
  obtenerUsuarios(): Observable<Usuario[]> { return this.api.get<Usuario[]>('usuarios'); }
  obtenerUsuario(id: number): Observable<Usuario> { return this.api.get<Usuario>(`usuarios/${id}`); }
  convertirEnVendedor(id: number, datos: {
    nombreCompleto: string; telefono: string; numeroCuenta: string;
    datosPago: string; consentimientoDatos: boolean;
  }): Observable<Usuario> { return this.api.patch<Usuario>(`usuarios/${id}/vendedor`, datos); }
}
