import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { ProductoService } from '../../services/producto.service';
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

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private productoService: ProductoService
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
  
  agregarAlCarrito(): void {
    if (this.producto) {
      // Aquí implementaremos la lógica para agregar al carrito
      console.log('Agregando al carrito:', this.producto, 'Cantidad:', this.cantidad);
      
      // Navegamos al carrito después de agregar
      this.router.navigate(['/carrito']);
    }
  }
} 