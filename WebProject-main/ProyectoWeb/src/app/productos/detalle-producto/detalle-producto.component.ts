import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { ProductoService } from '../../services/producto.service';
import { CarritoService } from '../../services/carrito.service';
import { Producto } from '../../models/producto.model';

@Component({
  selector: 'app-detalle-producto',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './detalle-producto.component.html',
  styleUrls: ['./detalle-producto.component.css']
})
export class DetalleProductoComponent implements OnInit {
  producto?: Producto;
  cargando = true;
  error = false;
  cantidad = 1;
  mensaje = '';
  tipoMensaje: 'success' | 'error' | '' = '';

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private productoService: ProductoService,
    private carritoService: CarritoService
  ) { }

  ngOnInit(): void {
    this.route.paramMap.subscribe(params => {
      const id = Number(params.get('id'));
      this.cargarProducto(id);
    });
  }

  cargarProducto(id: number): void {
    this.productoService.obtenerProducto(id).subscribe({
      next: (producto: Producto) => {
        if (producto) {
          this.producto = producto;
        } else {
          this.error = true;
        }
        this.cargando = false;
      },
      error: (err: any) => {
        console.error('Error al cargar el producto', err);
        this.error = true;
        this.cargando = false;
      }
    });
  }
  
  get stockDisponible(): number {
    if (!this.producto) return 0;
    const stock = this.producto.stock ?? this.producto.cantidadDisponible ?? 0;
    const value = Number(stock);
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
  }

  get disponible(): boolean {
    return this.stockDisponible > 0;
  }

  agregarAlCarrito(): void {
    if (!this.producto) return;

    if (!this.disponible) {
      this.mostrarMensaje('Este producto está agotado', 'error');
      return;
    }

    const cantidad = Math.max(1, Math.floor(Number(this.cantidad) || 1));
    if (cantidad > this.stockDisponible) {
      this.mostrarMensaje('No hay suficiente stock disponible', 'error');
      return;
    }

    this.cantidad = cantidad;
    try {
      this.carritoService.agregarProducto(this.producto, cantidad);
    } catch (err) {
      const mensajeError = err instanceof Error ? err.message : 'Error al agregar al carrito';
      this.mostrarMensaje(mensajeError, 'error');
      return;
    }
    this.mostrarMensaje('Producto agregado al carrito', 'success');
    this.router.navigate(['/carrito']);
  }

  private mostrarMensaje(mensaje: string, tipo: 'success' | 'error'): void {
    this.mensaje = mensaje;
    this.tipoMensaje = tipo;
  }
} 