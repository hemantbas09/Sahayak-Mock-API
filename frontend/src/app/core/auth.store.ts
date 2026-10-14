/**
 * AuthStore — Phase 1: Open access with default admin session.
 */
import { Injectable, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AuthUser, UserRole } from './types';

const TOKEN_STORAGE_KEY = 'sahayak.authToken';
const API_BASE = '/api';

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

  constructor() {
    void this.autoAuthenticateSeed();
  }

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

  /**
   * Transparently auto-authenticates with seed admin if the running server
   * instance has auth enforcement active.
   */
  async autoAuthenticateSeed(): Promise<boolean> {
    try {
      const response = await fetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'admin@example.com', password: 'admin1234' }),
      });
      if (response.ok) {
        const data = await response.json();
        if (data?.token) {
          localStorage.setItem(TOKEN_STORAGE_KEY, data.token);
          if (data.user) this.user.set(data.user);
          return true;
        }
      }
    } catch {
      // Server may have auth disabled or unreachable; non-critical in Phase 1
    }
    return false;
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
