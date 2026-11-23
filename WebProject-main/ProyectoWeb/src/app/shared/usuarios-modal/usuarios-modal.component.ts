import { Component, EventEmitter, Input, OnChanges, OnInit, Output, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { UsuarioService, ListaUsuario } from '../../services/usuario.service';

@Component({
  selector: 'app-usuarios-modal',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './usuarios-modal.component.html',
  styleUrls: ['./usuarios-modal.component.css']
})
export class UsuariosModalComponent implements OnInit, OnChanges {
  @Input() visible = false;
  @Output() close = new EventEmitter<void>();
  
  compradores: ListaUsuario[] = [];
  vendedores: ListaUsuario[] = [];
  loading = false;
  error = '';

  constructor(private usuarioService: UsuarioService) { }

  ngOnInit(): void {
  }

  ngOnChanges(changes: SimpleChanges): void {
    // Si el modal se hace visible, cargar los usuarios automáticamente
    if (changes['visible'] && changes['visible'].currentValue === true && !changes['visible'].firstChange) {
      this.cargarUsuarios();
    }
  }

  cargarUsuarios(): void {
    this.loading = true;
    this.error = '';
    
    this.usuarioService.obtenerUsuarios().subscribe({
      next: (usuarios) => {
        console.log('Usuarios recibidos:', usuarios);
        this.filtrarUsuarios(usuarios);
        this.loading = false;
      },
      error: (err) => {
        console.error('Error al cargar usuarios:', err);
        this.error = err.error?.message || 'Error al cargar la lista de usuarios';
        this.loading = false;
        // Reiniciar las listas en caso de error
        this.compradores = [];
        this.vendedores = [];
      }
    });
  }

  private filtrarUsuarios(usuarios: ListaUsuario[]): void {
    // Asegurar que usuarios es un array antes de filtrar
    if (!Array.isArray(usuarios)) {
      console.error('Se esperaba un array de usuarios pero se recibió:', usuarios);
      this.error = 'Error en el formato de datos recibidos';
      this.compradores = [];
      this.vendedores = [];
      return;
    }
    
    // Filtrar usuarios por rol
    this.compradores = usuarios.filter(u => u.role === 'buyer');
    this.vendedores = usuarios.filter(u => u.role === 'seller');
    
    console.log('Compradores:', this.compradores.length);
    console.log('Vendedores:', this.vendedores.length);
  }

  closeModal(): void {
    this.close.emit();
  }
}
