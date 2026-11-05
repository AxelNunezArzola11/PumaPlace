export interface Categoria {
  id: number;
  nombre: string;
  category?: string;
  descripcion?: string;
}

export interface Vendedor {
  id: number;
  correo: string;
  name?: string;
}

export interface Producto {
  id: number;
  nombre: string;
  descripcion: string;
  precio: number;
  categoriaId: number;
  cantidadDisponible?: number;
  vendedorId?: number;
  estado?: string;
  name?: string;
  description?: string;
  price?: number;
  image_url?: string;
  imagenUrl?: string;
  category_product_id?: number;
  stock: number;
  user_id?: number;
  category?: Categoria;
  seller?: Vendedor;
  inventario?: { cantidadDisponible: number };
}

export interface CreateProductoDTO {
  categoriaId: number;
  nombre: string;
  descripcion: string;
  precio: number;
  cantidadDisponible?: number;
  imagenUrl?: string;
}