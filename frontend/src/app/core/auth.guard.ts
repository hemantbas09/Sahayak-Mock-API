import { CanActivateFn, CanMatchFn } from '@angular/router';
import { UserRole } from './types';

/** Phase 1: Open access (no login required). */
export const requireAuth: CanActivateFn = () => true;

export function requireRole(_minimumRole: UserRole): CanActivateFn {
  return () => true;
}

export const matchAuth: CanMatchFn = () => true;
