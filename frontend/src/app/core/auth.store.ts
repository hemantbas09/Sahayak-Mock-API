/**
 * AuthStore — Phase 1: Open access with default admin session.
 */
import { Injectable, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AuthUser, UserRole } from './types';

const TOKEN_STORAGE_KEY = 'sahayak.authToken';

@Injectable({ providedIn: 'root' })
export class AuthStore {
  private readonly router = inject(Router);

  /** Currently authenticated user (defaults to admin in Phase 1). */
  readonly user = signal<AuthUser | null>({
    email: 'admin@sahayak.local',
    role: 'admin',
  });

  /** Always authenticated in Phase 1. */
  readonly authenticated = signal<boolean>(true);

  get token(): string | null {
    return localStorage.getItem(TOKEN_STORAGE_KEY);
  }

  get role(): UserRole | null {
    return this.user()?.role ?? 'admin';
  }

  /** Always true for role checks in Phase 1. */
  hasRole(_minimumRole: UserRole): boolean {
    return true;
  }

  login(_email: string, _password: string): Promise<void> {
    this.authenticated.set(true);
    return Promise.resolve();
  }

  logout(): void {
    // No-op for Phase 1 open access
  }

  clearSession(): void {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
  }
}
