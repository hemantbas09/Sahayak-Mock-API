/**
 * AuthStore — JWT session state (DESIGN F2).
 *
 * - login() stores the token in localStorage (survives refresh).
 * - The HTTP interceptor (auth.interceptor.ts) attaches the token and
 *   clears the session on 401 so the app returns to /login.
 * - Guards (auth.guard.ts) branch on the role signal.
 */
import { Injectable, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { MockApiClient } from './mock-api.client';
import { AuthUser, UserRole } from './types';

const TOKEN_STORAGE_KEY = 'sahayak.authToken';

@Injectable({ providedIn: 'root' })
export class AuthStore {
  private readonly apiClient = inject(MockApiClient);
  private readonly router = inject(Router);

  /** Currently authenticated user (null = not logged in). */
  readonly user = signal<AuthUser | null>(null);
  /** Whether a token is present (drives the 401 redirect). */
  readonly authenticated = signal<boolean>(false);

  constructor() {
    this.restoreSession();
  }

  get token(): string | null {
    return localStorage.getItem(TOKEN_STORAGE_KEY);
  }

  get role(): UserRole | null {
    return this.user()?.role ?? null;
  }

  /** True for the given minimum role (admin > editor > viewer). */
  hasRole(minimumRole: UserRole): boolean {
    const currentRole = this.user()?.role;
    if (!currentRole) return false;
    const roleRank: Record<UserRole, number> = { viewer: 1, editor: 2, admin: 3 };
    return roleRank[currentRole] >= roleRank[minimumRole];
  }

  /** Restore a session persisted from a previous visit. */
  private restoreSession(): void {
    const storedToken = localStorage.getItem(TOKEN_STORAGE_KEY);
    if (!storedToken) return;
    this.apiClient.whoAmI().then(
      (sessionUser) => {
        this.user.set(sessionUser);
        this.authenticated.set(true);
      },
      () => this.clearSession(),
    );
  }

  login(email: string, password: string): Promise<void> {
    return this.apiClient.login(email, password).then((loginResult) => {
      localStorage.setItem(TOKEN_STORAGE_KEY, loginResult.token);
      this.user.set(loginResult.user);
      this.authenticated.set(true);
    });
  }

  logout(): void {
    this.clearSession();
    void this.router.navigate(['/login']);
  }

  /** Drop the session (also called by the interceptor on 401). */
  clearSession(): void {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    this.user.set(null);
    this.authenticated.set(false);
  }
}
