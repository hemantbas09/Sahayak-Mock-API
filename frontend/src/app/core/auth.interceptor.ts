/**
 * JWT auth interceptor (DESIGN F2).
 *
 * Attaches `Authorization: Bearer <token>` to every request. On 401 the
 * session is cleared and the app returns to /login (the login route itself
 * is public, so a bad login attempt simply shows its error).
 */
import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { AuthStore } from './auth.store';

export const authInterceptor: HttpInterceptorFn = (httpRequest, nextHandle) => {
  const authStore = inject(AuthStore);
  const router = inject(Router);
  const bearerToken = authStore.token;
  const outgoingRequest = bearerToken
    ? httpRequest.clone({ setHeaders: { Authorization: `Bearer ${bearerToken}` } })
    : httpRequest;

  return nextHandle(outgoingRequest).pipe(
    catchError((caught) => {
      if (caught?.status === 401 && authStore.authenticated()) {
        authStore.clearSession();
        void router.navigate(['/login']);
      }
      return throwError(() => caught);
    }),
  );
};
