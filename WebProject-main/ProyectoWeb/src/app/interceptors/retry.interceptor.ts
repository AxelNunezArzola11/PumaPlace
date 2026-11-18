import { Injectable } from '@angular/core';
import { HttpErrorResponse, HttpInterceptor, HttpRequest, HttpHandler, HttpEvent } from '@angular/common/http';
import { Observable, throwError, timer } from 'rxjs';
import { retry } from 'rxjs/operators';

/**
 * Safe retries for Render cold starts and transient gateway errors.
 *
 * ONLY idempotent GET requests are retried, and only on network failures or
 * transient statuses (0, 408, 429, 502, 503, 504). Writes (POST/PATCH/PUT/
 * DELETE) are never auto-retried: repeating a payment or order call could
 * charge twice. Backoff is 500ms → 1s → 2s, max 3 attempts.
 *
 * Registered AFTER ErrorInterceptor so retries see the raw HTTP error before
 * it is mapped to a user-facing message.
 */
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 500;
const RETRIABLE_STATUS = new Set([0, 408, 429, 502, 503, 504]);

function isSafeToRetry(request: HttpRequest<unknown>, error: unknown): boolean {
  if (request.method !== 'GET') return false;
  const status = error instanceof HttpErrorResponse ? error.status : 0;
  return RETRIABLE_STATUS.has(status);
}

@Injectable()
export class RetryInterceptor implements HttpInterceptor {
  intercept(request: HttpRequest<unknown>, next: HttpHandler): Observable<HttpEvent<unknown>> {
    return next.handle(request).pipe(
      retry({
        count: MAX_RETRIES,
        delay: (error: unknown, retryCount: number) => {
          if (!isSafeToRetry(request, error)) return throwError(() => error);
          return timer(BASE_DELAY_MS * 2 ** (retryCount - 1));
        },
      }),
    );
  }
}
