import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { CarritoService } from '../../services/carrito.service';

@Component({
  selector: 'app-carrito-icon',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './carrito-icon.component.html',
  styleUrls: ['./carrito-icon.component.css']
})
export class CarritoIconComponent implements OnInit {
  cantidadProductos: number = 0;

  constructor(private carritoService: CarritoService) { }

  ngOnInit(): void {
    this.carritoService.obtenerCantidadTotal().subscribe(cantidad => {
      this.cantidadProductos = cantidad;
    });
  }
} 