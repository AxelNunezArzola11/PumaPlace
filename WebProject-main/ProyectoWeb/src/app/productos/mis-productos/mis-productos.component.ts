import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { ProductoService } from '../../services/producto.service';
import { Producto } from '../../models/producto.model';

@Component({
  selector: 'app-mis-productos',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './mis-productos.component.html',
  styleUrls: ['./mis-productos.component.css']
})
export class MisProductosComponent implements OnInit {
  productos: Producto[] = [];
  loading = true;
  error = '';

  constructor(private productoService: ProductoService) {}

  ngOnInit(): void {
    this.cargarProductos();
  }

  cargarProductos(): void {
    this.loading = true;
    this.error = '';
    this.productoService.obtenerProductosPorVendedor().subscribe({
      next: productos => {
        this.productos = productos;
        this.loading = false;
      },
      error: err => {
        console.error('Error al cargar productos:', err);
        this.error = 'Error al cargar los productos. Intente nuevamente.';
        this.loading = false;
      }
    });
  }

  eliminarProducto(id: number): void {
    if (!confirm('¿Está seguro de eliminar este producto?')) return;

    this.productoService.eliminarProducto(id).subscribe({
      next: () => {
        this.productos = this.productos.filter(producto => producto.id !== id);
      },
      error: err => {
        console.error('Error al eliminar producto:', err);
        alert(err.status === 404
          ? 'El producto no se encontró. Puede que ya haya sido eliminado.'
          : 'Error al eliminar el producto. Intente nuevamente.');
      }
    });
  }

  getSafeImageUrl(url: string | undefined): string {
    return url || 'assets/images/PumaXpress.png';
  }
}
