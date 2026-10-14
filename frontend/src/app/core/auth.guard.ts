/**
 * Route guards (DESIGN F2): unauthenticated users can't reach the editor;
 * role-checked routes reject lower roles (e.g. delete is admin-only).
 */
import { inject } from '@angular/core';
import { CanActivateFn, CanMatchFn, Router } from '@angular/router';
import { AuthStore } from './auth.store';
import { UserRole } from './types';

/** Any signed-in user. */
export const requireAuth: CanActivateFn = () => {
  const authStore = inject(AuthStore);
  const router = inject(Router);
  return authStore.authenticated() ? true : router.createUrlTree(['/login']);
};

/** A specific minimum role (admin > editor > viewer). */
export function requireRole(minimumRole: UserRole): CanActivateFn {
  return () => {
    const authStore = inject(AuthStore);
    const router = inject(Router);
    return authStore.hasRole(minimumRole) ? true : router.createUrlTree(['/environments']);
  };
}

/**
 * CanMatch variant: hides protected routes from the menu even before
 * navigation (used for admin-only areas).
 */
export const matchAuth: CanMatchFn = () => {
  const authStore = inject(AuthStore);
  return authStore.authenticated();
};
