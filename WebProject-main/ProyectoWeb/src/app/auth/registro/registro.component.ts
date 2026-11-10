import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-registro',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterModule],
  templateUrl: './registro.component.html',
  styleUrls: ['./registro.component.css']
})
export class RegistroComponent {
  registroForm: FormGroup;
  error: string = '';
  loading: boolean = false;
  constructor(
    private fb: FormBuilder,
    private router: Router,
    private authService: AuthService
  ) {
    this.registroForm = this.fb.group({
      nombre: [''],
      apellido: [''],
      email: ['', [Validators.required, Validators.email, Validators.pattern(/@unam\.mx$/i)]],
      edad: [18, [Validators.required, Validators.min(18)]],
      password: ['', [Validators.required, Validators.minLength(8)]],
      confirmarPassword: ['', [Validators.required]],
      consentimientoDatos: [false, [Validators.requiredTrue]]
    }, { 
      validators: this.passwordMatchValidator
    });

  }

  passwordMatchValidator(form: FormGroup) {
    const password = form.get('password')?.value;
    const confirmarPassword = form.get('confirmarPassword')?.value;
    return password === confirmarPassword ? null : { mismatch: true };
  }

  onSubmit() {
    if (this.registroForm.valid) {
      this.loading = true;
      this.error = '';
      
      const datosUsuario = {
        correo: this.registroForm.value.email,
        edad: this.registroForm.value.edad,
        password: this.registroForm.value.password,
        consentimientoDatos: this.registroForm.value.consentimientoDatos,
      };
      
      this.authService.registro(datosUsuario)
        .subscribe({
          next: () => {
            this.router.navigate(['/login']);
          },
          error: (err) => {
            this.error = err.message || 'Error al registrar el usuario. Intente nuevamente.';
            this.loading = false;
            console.error('Error de registro:', err);
          }
        });
    }
  }

}