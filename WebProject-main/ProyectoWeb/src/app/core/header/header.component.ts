import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { Usuario } from '../../models/usuario.model';
import { CarritoIconComponent } from '../../components/carrito-icon/carrito-icon.component';
import { PasswordModalComponent } from '../../shared/password-modal/password-modal.component';
import { UsuarioService } from '../../services/usuario.service';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [CommonModule, RouterModule, ReactiveFormsModule, CarritoIconComponent, PasswordModalComponent],
  templateUrl: './header.component.html',
  styleUrls: ['./header.component.css']
})
export class HeaderComponent implements OnInit {
  usuario: Usuario | null = null;
  passwordModalVisible = false;
  sellerError = '';
  convertingToSeller = false;
  sellerForm: ReturnType<FormBuilder['group']>;
  sellerFormVisible = false;

  constructor(
    private authService: AuthService,
    private router: Router,
    private usuarioService: UsuarioService,
    private formBuilder: FormBuilder,
  ) {
    this.sellerForm = this.formBuilder.group({
      nombreCompleto: ['', [Validators.required, Validators.minLength(3)]],
      telefono: ['', [Validators.required, Validators.pattern(/^\+?[0-9]{10,15}$/)]],
      numeroCuenta: ['', [Validators.required, Validators.pattern(/^[0-9]{6,12}$/)]],
      datosPago: ['', [Validators.required, Validators.minLength(5)]],
      consentimientoDatos: [false, Validators.requiredTrue],
    });
  }

  ngOnInit(): void {
    this.authService.usuario$.subscribe(usuario => {
      this.usuario = usuario;
    });
  }

  cerrarSesion(): void {
    this.authService.logout();
    this.router.navigate(['/login']);
  }

  convertirEnVendedor(): void {
    if (!this.usuario?.id || this.convertingToSeller) return;
    this.sellerFormVisible = true;
  }

  enviarSolicitudVendedor(): void {
    if (!this.usuario?.id || this.sellerForm.invalid) {
      this.sellerForm.markAllAsTouched();
      return;
    }

    this.sellerError = '';
    this.convertingToSeller = true;
    this.usuarioService.convertirEnVendedor(this.usuario.id, this.sellerForm.getRawValue() as {
      nombreCompleto: string; telefono: string; numeroCuenta: string;
      datosPago: string; consentimientoDatos: boolean;
    }).subscribe({
      next: usuario => {
        const actualizado = { ...this.usuario, ...usuario };
        sessionStorage.setItem('usuario', JSON.stringify(actualizado));
        this.authService.actualizarUsuario(actualizado);
        this.convertingToSeller = false;
        this.sellerFormVisible = false;
        this.router.navigate(['/productos/crear']);
      },
      error: error => {
        this.convertingToSeller = false;
        this.sellerError = error?.error?.message || error?.message || 'No se pudo activar la venta.';
      },
    });
  }

  abrirModalPassword(): void {
    this.passwordModalVisible = true;
  }

  cerrarModalPassword(): void {
    this.passwordModalVisible = false;
  }
} 