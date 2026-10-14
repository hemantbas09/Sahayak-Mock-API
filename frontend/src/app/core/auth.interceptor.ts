import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { AuthStore } from './auth.store';

export const authInterceptor: HttpInterceptorFn = (httpRequest, nextHandle) => {
  const authStore = inject(AuthStore);
  const bearerToken = authStore.token;
  const outgoingRequest = bearerToken
    ? httpRequest.clone({ setHeaders: { Authorization: `Bearer ${bearerToken}` } })
    : httpRequest;

  return nextHandle(outgoingRequest);
};
