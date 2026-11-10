import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

export const sellerGuard: CanActivateFn = (route, state) => {
  const authService = inject(AuthService);
  const router = inject(Router);
  if (authService.esVendedor()) {
    return true;
  }

  // Redirigir a productos si no es vendedor
  router.navigate(['/productos']);
  return false;
}; 