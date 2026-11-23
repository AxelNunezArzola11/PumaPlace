import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { CredencialesLogin } from '../../models/usuario.model';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterModule],
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.css']
})
export class LoginComponent {
  loginForm: FormGroup;
  error: string = '';
  loading: boolean = false;

  constructor(
    private fb: FormBuilder,
    private router: Router,
    private authService: AuthService
  ) {
    this.loginForm = this.fb.group({
      email: ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required]]
    });
  }

  onSubmit() {
    if (this.loginForm.valid) {
      this.loading = true;
      this.error = '';
      
      // Extract email and password from form values and create credentials object
      const credenciales: CredencialesLogin = {
        correo: this.loginForm.value.email,
        password: this.loginForm.value.password
      };
      
      this.authService.login(credenciales)
        .subscribe({
          next: (usuario) => {
            // Redirigir según el rol del usuario
            if (usuario.rol === 'vendedor' || usuario.rol === 'dual') {
              this.router.navigate(['/mis-productos']);
            } else {
              this.router.navigate(['/productos']);
            }
          },
          error: (err) => {
            if (err.error && err.error.message) {
              this.error = err.error.message;
            } else if (err.status === 401) {
              this.error = 'Email o contraseña incorrectos';
            } else {
              this.error = 'Error al iniciar sesión. Intente nuevamente.';
            }
            
            this.loading = false;
            console.error('Error de login:', err);
          }
        });
    }
  }
} 