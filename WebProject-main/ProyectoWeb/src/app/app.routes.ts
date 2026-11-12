import { Routes } from '@angular/router';
import { authGuard } from './guards/auth.guard';
import { sellerGuard } from './guards/seller.guard';
import { buyerGuard } from './guards/buyer.guard';

export const routes: Routes = [
  { path: '', redirectTo: 'login', pathMatch: 'full' },
  { path: 'registro', loadComponent: () => import('./auth/registro/registro.component').then(c => c.RegistroComponent) },
  { path: 'login', loadComponent: () => import('./auth/login/login.component').then(c => c.LoginComponent) },
  { path: 'productos', loadComponent: () => import('./productos/lista-productos/lista-productos.component').then(c => c.ListaProductosComponent) },
  { 
    path: 'productos/crear', 
    loadComponent: () => import('./productos/crear-producto/crear-producto.component').then(c => c.CrearProductoComponent),
    canActivate: [authGuard, sellerGuard]
  },
  { 
    path: 'productos/editar/:id', 
    loadComponent: () => import('./productos/crear-producto/crear-producto.component').then(c => c.CrearProductoComponent),
    canActivate: [authGuard, sellerGuard]
  },
  { path: 'productos/:id', loadComponent: () => import('./productos/detalle-producto/detalle-producto.component').then(c => c.DetalleProductoComponent) },
  { 
    path: 'mis-productos', 
    loadComponent: () => import('./productos/mis-productos/mis-productos.component').then(c => c.MisProductosComponent),
    canActivate: [authGuard, sellerGuard]
  },
  { 
    path: 'carrito', 
    loadComponent: () => import('./pages/carrito/carrito.component').then(c => c.CarritoComponent)
  },
  { 
    path: 'pago', 
    loadComponent: () => import('./compra/pago/pago.component').then(c => c.PagoComponent),
    canActivate: [authGuard, buyerGuard]
  },
  { path: 'ordenes', loadComponent: () => import('./pages/ordenes/ordenes.component').then(c => c.OrdenesComponent), canActivate: [authGuard] },
  { path: 'ordenes/:id', loadComponent: () => import('./pages/ordenes/orden-detalle.component').then(c => c.OrdenDetalleComponent), canActivate: [authGuard] },
  { path: 'notificaciones', loadComponent: () => import('./pages/notificaciones/notificaciones.component').then(c => c.NotificacionesComponent), canActivate: [authGuard] },
];
