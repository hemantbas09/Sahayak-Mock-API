import { inject } from '@angular/core';
import { CanActivateFn, CanMatchFn, Router } from '@angular/router';
import { AuthStore } from './auth.store';
import { UserRole } from './types';

export const requireAuth: CanActivateFn = () => {
  const authStore = inject(AuthStore);
  const router = inject(Router);

  if (authStore.authenticated()) {
    return true;
  }

  return router.createUrlTree(['/login']);
};

export function requireRole(minimumRole: UserRole): CanActivateFn {
  return () => {
    const authStore = inject(AuthStore);
    const router = inject(Router);

    if (!authStore.authenticated()) {
      return router.createUrlTree(['/login']);
    }

    if (authStore.hasRole(minimumRole)) {
      return true;
    }

    return router.createUrlTree(['/environments']);
  };
}

export const matchAuth: CanMatchFn = () => {
  const authStore = inject(AuthStore);
  return authStore.authenticated();
};
