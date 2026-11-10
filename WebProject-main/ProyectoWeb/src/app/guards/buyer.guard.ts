import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

export const buyerGuard: CanActivateFn = (route, state) => {
  const authService = inject(AuthService);
  const router = inject(Router);
  if (authService.estaAutenticado()) {
    return true;
  }

  // Redirigir a mis-productos si no es comprador
  router.navigate(['/mis-productos']);
  return false;
}; 