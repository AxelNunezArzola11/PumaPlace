import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, map, tap } from 'rxjs';
import { environment } from '../../environments/environment';
import { CredencialesLogin, RegistroUsuario, Usuario } from '../models/usuario.model';

interface AuthResponse { data: { token: string; usuario: Usuario }; }

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly usuarioSubject = new BehaviorSubject<Usuario | null>(this.restoreUser());
  readonly usuario$ = this.usuarioSubject.asObservable();

  constructor(private readonly http: HttpClient) {}

  login(credentials: CredencialesLogin): Observable<Usuario> {
    return this.http.post<AuthResponse>(`${environment.apiUrl}/auth/login`, credentials).pipe(
      map(response => ({ ...response.data.usuario, token: response.data.token })),
      tap(usuario => this.persistUser(usuario)),
    );
  }

  registro(datos: RegistroUsuario): Observable<Usuario> {
    return this.http.post<{ data: Usuario }>(`${environment.apiUrl}/auth/register`, datos)
      .pipe(map(response => response.data));
  }

  logout(): void {
    sessionStorage.removeItem('usuario');
    sessionStorage.removeItem('token');
    this.usuarioSubject.next(null);
  }

  obtenerToken(): string | null {
    return sessionStorage.getItem('token') || this.usuarioSubject.value?.token || null;
  }

  obtenerUsuarioId(): number | null { return this.usuarioSubject.value?.id ?? null; }
  getUsuarioActual(): Usuario | null { return this.usuarioSubject.value; }
  actualizarUsuario(usuario: Usuario): void {
    if (usuario.token) sessionStorage.setItem('token', usuario.token);
    sessionStorage.setItem('usuario', JSON.stringify(usuario));
    this.usuarioSubject.next(usuario);
  }
  estaAutenticado(): boolean { return Boolean(this.obtenerToken()); }
  esVendedor(): boolean { return ['vendedor', 'dual'].includes(this.usuarioSubject.value?.rol ?? ''); }
  updatePassword(_password: string): Observable<unknown> {
    return this.http.patch(`${environment.apiUrl}/usuarios/${this.obtenerUsuarioId()}`, {});
  }

  private persistUser(usuario: Usuario): void {
    if (usuario.token) sessionStorage.setItem('token', usuario.token);
    sessionStorage.setItem('usuario', JSON.stringify(usuario));
    this.usuarioSubject.next(usuario);
  }

  private restoreUser(): Usuario | null {
    const raw = sessionStorage.getItem('usuario');
    return raw ? JSON.parse(raw) as Usuario : null;
  }
}
