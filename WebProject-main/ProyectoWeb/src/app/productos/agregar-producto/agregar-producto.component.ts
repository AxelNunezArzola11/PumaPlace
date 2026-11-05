import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { ProductoService } from '../../services/producto.service';

@Component({
  selector: 'app-agregar-producto',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './agregar-producto.component.html',
  styleUrls: ['./agregar-producto.component.css']
})
export class AgregarProductoComponent {
  productoForm: FormGroup;
  categorias = ['Electrónica', 'Ropa', 'Hogar', 'Deportes', 'Juguetes', 'Libros'];
  
  constructor(
    private fb: FormBuilder,
    private productoService: ProductoService,
    private router: Router
  ) {
    this.productoForm = this.fb.group({
      nombre: ['', [Validators.required]],
      descripcion: ['', [Validators.required]],
      precio: ['', [Validators.required, Validators.min(0)]],
      stock: ['', [Validators.required, Validators.min(0)]],
      imagen: ['', [Validators.required]],
      categoria: ['', [Validators.required]],
      vendedor: ['', [Validators.required]]
    });
  }

  onSubmit() {
    if (this.productoForm.valid) {
      this.productoService.agregarProducto(this.productoForm.value).subscribe({
        next: (producto) => {
          console.log('Producto agregado:', producto);
          this.router.navigate(['/productos']);
        },
        error: (err) => {
          console.error('Error al agregar producto', err);
        }
      });
    }
  }
} 