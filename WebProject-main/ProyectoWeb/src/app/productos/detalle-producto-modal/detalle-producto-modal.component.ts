import { Component, Input, Output, EventEmitter, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Producto } from '../../models/producto.model';
import { CarritoService } from '../../services/carrito.service';

@Component({
  selector: 'app-detalle-producto-modal',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './detalle-producto-modal.component.html',
  styleUrls: ['./detalle-producto-modal.component.css']
})
export class DetalleProductoModalComponent implements OnChanges {
  @Input() producto: Producto | null = null;
  @Input() visible = false;
  @Output() close = new EventEmitter<void>();
  
  mensaje: string = '';
  tipoMensaje: 'success' | 'error' | '' = '';
  cantidad: number = 1;

  constructor(private carritoService: CarritoService) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['producto'] && changes['producto'].currentValue) {
      console.log('Modal: Producto recibido en el modal:', this.producto);
      // Resetear la cantidad cuando cambia el producto
      this.cantidad = 1;
    }
    if (changes['visible']) {
      console.log('Modal: Visibilidad cambiada a:', this.visible);
      if (this.visible) {
        // Resetear mensajes al abrir el modal
        this.mensaje = '';
        this.tipoMensaje = '';
      }
    }
  }

  cerrarModal(): void {
    this.close.emit();
  }

  // Stock real del producto, contemplando los distintos nombres que puede
  // devolver el backend (stock o cantidadDisponible).
  get stockDisponible(): number {
    if (!this.producto) return 0;
    const stock = this.producto.stock ?? this.producto.cantidadDisponible ?? 0;
    const value = Number(stock);
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
  }

  get disponible(): boolean {
    return this.stockDisponible > 0;
  }

  // Aumentar cantidad
  aumentarCantidad(): void {
    if (this.disponible && this.cantidad < this.stockDisponible) {
      this.cantidad++;
    }
  }

  // Disminuir cantidad
  disminuirCantidad(): void {
    if (this.cantidad > 1) {
      this.cantidad--;
    }
  }

  // Agregar al carrito
  agregarAlCarrito(): void {
    if (!this.producto) {
      this.mostrarMensaje('No se puede agregar el producto al carrito', 'error');
      return;
    }

    if (!this.disponible) {
      this.mostrarMensaje('Este producto está agotado', 'error');
      return;
    }

    if (this.stockDisponible < this.cantidad) {
      this.mostrarMensaje('No hay suficiente stock disponible', 'error');
      return;
    }

    try {
      this.carritoService.agregarProducto(this.producto, this.cantidad);
      this.mostrarMensaje('Producto agregado al carrito', 'success');
    } catch (err) {
      console.error('Error al agregar al carrito:', err);
      const mensajeError = err instanceof Error ? err.message : 'Error al agregar al carrito';
      this.mostrarMensaje(mensajeError, 'error');
    }
  }

  // Mostrar un mensaje temporal
  private mostrarMensaje(mensaje: string, tipo: 'success' | 'error'): void {
    this.mensaje = mensaje;
    this.tipoMensaje = tipo;
    
    // Ocultar el mensaje después de 3 segundos
    setTimeout(() => {
      this.mensaje = '';
      this.tipoMensaje = '';
    }, 3000);
  }

  getSafeImageUrl(url: string | undefined): string {
    if (!url) return 'assets/images/placeholder.png';
    
    // Para URLs de ImgBB, verificamos si es la URL de la página (ibb.co) y no la directa (i.ibb.co)
    if (url.includes('ibb.co')) {
      // Si ya es una URL directa de i.ibb.co, la usamos directamente
      if (url.includes('i.ibb.co')) {
        return url;
      }
      
      // Si es una URL de visualización de ImgBB (como https://ibb.co/XkZ1t5dw)
      // intentamos extraer el ID y formar una URL directa de prueba
      const idMatch = url.match(/ibb\.co\/([A-Za-z0-9]+)/);
      if (idMatch && idMatch[1]) {
        // Intentamos una URL directa con el ID extraído
        return `https://i.ibb.co/${idMatch[1]}/image.jpg`;
      }
    }
    
    return url;
  }
} 