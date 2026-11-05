import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-password-modal',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './password-modal.component.html',
  styleUrls: ['./password-modal.component.css']
})
export class PasswordModalComponent implements OnInit {
  @Input() visible = false;
  @Output() close = new EventEmitter<void>();
  
  passwordForm!: FormGroup;
  loading = false;
  error = '';
  success = false;
  showPassword = false;

  constructor(
    private fb: FormBuilder,
    private authService: AuthService
  ) {}

  ngOnInit(): void {
    this.initForm();
  }

  private initForm(): void {
    this.passwordForm = this.fb.group({
      password: ['', [Validators.required, Validators.minLength(6)]],
      confirmPassword: ['', [Validators.required]]
    }, { validators: this.passwordMatchValidator });
  }

  passwordMatchValidator(form: FormGroup) {
    const password = form.get('password')?.value;
    const confirmPassword = form.get('confirmPassword')?.value;
    
    if (password && confirmPassword && password !== confirmPassword) {
      form.get('confirmPassword')?.setErrors({ passwordMismatch: true });
      return { passwordMismatch: true };
    }
    
    return null;
  }

  togglePasswordVisibility(): void {
    this.showPassword = !this.showPassword;
  }

  closeModal(): void {
    this.resetForm();
    this.close.emit();
  }

  onSubmit(): void {
    if (this.passwordForm.invalid) {
      return;
    }

    this.loading = true;
    this.error = '';
    this.success = false;

    const { password } = this.passwordForm.value;

    this.authService.updatePassword(password).subscribe({
      next: (response) => {
        this.loading = false;
        this.success = true;
        
        // Cerrar el modal después de 2 segundos
        setTimeout(() => {
          this.closeModal();
        }, 2000);
      },
      error: (err) => {
        this.loading = false;
        this.error = err.error?.message || 'Error al actualizar la contraseña';
        console.error('Error al actualizar la contraseña:', err);
      }
    });
  }

  resetForm(): void {
    this.passwordForm.reset();
    this.error = '';
    this.success = false;
    this.loading = false;
    this.showPassword = false;
  }
}
