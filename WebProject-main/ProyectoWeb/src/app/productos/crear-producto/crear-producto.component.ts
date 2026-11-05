import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { ProductoService } from '../../services/producto.service';
import { Producto, CreateProductoDTO } from '../../models/producto.model';
import { CategoriaService } from '../../services/categoria.service';
import { Categoria } from '../../models/producto.model';

@Component({
  selector: 'app-crear-producto',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterModule],
  templateUrl: './crear-producto.component.html',
  styleUrls: ['./crear-producto.component.css']
})
export class CrearProductoComponent implements OnInit {
  productoForm: FormGroup;
  isEditing: boolean = false;
  productoId?: number;
  loading: boolean = false;
  error: string = '';
  categorias: Categoria[] = [];

  constructor(
    private fb: FormBuilder,
    private router: Router,
    private route: ActivatedRoute,
    private productoService: ProductoService,
    private categoriaService: CategoriaService
  ) {
    this.productoForm = this.fb.group({
      name: ['', [Validators.required, Validators.maxLength(150)]],
      description: ['', [Validators.required]],
      price: [null, [Validators.required, Validators.min(0.01)]],
      stock: [null, [Validators.required, Validators.min(1), Validators.pattern(/^\d+$/)]],
      image_url: [''],
      category_product_id: [null, [Validators.required]]
    });
  }

  ngOnInit(): void {
    this.categoriaService.obtenerCategorias().subscribe({
      next: categorias => {
        this.categorias = categorias;
        if (categorias.length && !this.productoForm.value.category_product_id) {
          this.productoForm.patchValue({ category_product_id: categorias[0].id });
        }
      },
      error: error => this.error = error.message || 'No se pudieron cargar las categorías.',
    });
    // Solo obtener el ID si estamos en la ruta de edición
    const url = this.router.url;
    if (url.includes('/editar/')) {
      this.isEditing = true;
      this.productoId = Number(this.route.snapshot.paramMap.get('id'));
      
      if (this.productoId) {
        this.cargarProducto(this.productoId);
      }
    }
  }

  cargarProducto(id: number): void {
    this.loading = true;
    
    this.productoService.obtenerProducto(id)
      .subscribe({
        next: (producto) => {
          this.productoForm.patchValue({
            name: producto.name,
            description: producto.description,
            price: producto.price,
            stock: producto.stock,
            image_url: producto.image_url || '',
            category_product_id: producto.category_product_id || 1
          });
          this.loading = false;
        },
        error: (err) => {
          console.error('Error al cargar producto:', err);
          this.error = 'Error al cargar el producto. Intente nuevamente.';
          this.loading = false;
        }
      });
  }

  onSubmit(): void {
    if (this.productoForm.valid) {
      this.loading = true;
      this.error = '';
      
      const value = this.productoForm.value;
      const productoData: CreateProductoDTO = {
        nombre: value.name,
        descripcion: value.description,
        precio: value.price,
        categoriaId: Number(value.category_product_id),
        cantidadDisponible: value.stock,
        imagenUrl: value.image_url || undefined,
      };
      
      if (this.isEditing && this.productoId) {
        this.productoService.actualizarProducto(this.productoId, productoData)
          .subscribe({
            next: () => {
              this.router.navigate(['/mis-productos']);
            },
            error: (err) => {
              console.error('Error al actualizar producto:', err);
              this.error = err.message || 'Error al actualizar el producto. Intente nuevamente.';
              this.loading = false;
            }
          });
      } else {
        this.productoService.crearProducto(productoData)
          .subscribe({
            next: () => {
              this.router.navigate(['/mis-productos']);
            },
            error: (err) => {
              console.error('Error al crear producto:', err);
              this.error = err.message || 'Error al crear el producto. Intente nuevamente.';
              this.loading = false;
            }
          });
      }
    }
  }

  // Método para obtener la URL correcta para la vista previa
  getPreviewUrl(url: string): string {
    if (!url) return '';
    
    // Para URLs de ImgBB
    if (url.includes('ibb.co')) {
      // Si ya es una URL directa de i.ibb.co, la usamos tal cual
      if (url.includes('i.ibb.co')) {
        return url;
      }
      
      // Si es una URL de visualización, intentamos extraer el ID
      const idMatch = url.match(/ibb\.co\/([A-Za-z0-9]+)/);
      if (idMatch && idMatch[1]) {
        // Intentamos formar una URL directa aproximada
        return `https://i.ibb.co/${idMatch[1]}/image.jpg`;
      }
    }
    
    return url;
  }
}
