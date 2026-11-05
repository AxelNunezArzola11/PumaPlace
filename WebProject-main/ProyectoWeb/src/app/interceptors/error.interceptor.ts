import { Injectable } from '@angular/core';
import { HttpErrorResponse, HttpInterceptor, HttpRequest, HttpHandler, HttpEvent } from '@angular/common/http';
import { Router } from '@angular/router';
import { Observable, catchError, throwError } from 'rxjs';
import { AuthService } from '../services/auth.service';

@Injectable()
export class ErrorInterceptor implements HttpInterceptor {
  constructor(private readonly authService: AuthService, private readonly router: Router) {}

  intercept(request: HttpRequest<unknown>, next: HttpHandler): Observable<HttpEvent<unknown>> {
    return next.handle(request).pipe(catchError((error: HttpErrorResponse) => {
      const body = error.error ?? {};
      const invalidParams = Array.isArray(body.invalid_params) ? body.invalid_params : [];
      const message = body.detail || body.title || body.message || error.statusText || 'Ocurrió un error';
      if (error.status === 401) {
        this.authService.logout();
        this.router.navigate(['/login']);
      }
      return throwError(() => ({
        status: error.status,
        message,
        title: body.title,
        detail: body.detail,
        invalid_params: invalidParams,
        error: body,
      }));
    }));
  }
}
