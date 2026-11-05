import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';
import { Categoria } from '../models/producto.model';

@Injectable({ providedIn: 'root' })
export class CategoriaService {
  constructor(private readonly api: ApiService) {}
  obtenerCategorias(): Observable<Categoria[]> { return this.api.get<Categoria[]>('categorias'); }
  obtenerCategoria(id: number): Observable<Categoria> { return this.api.get<Categoria>(`categorias/${id}`); }
}
