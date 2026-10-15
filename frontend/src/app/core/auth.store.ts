/**
 * AuthStore — Authentication state management for Sahayak platform.
 */
import { Injectable, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AuthUser, UserRole } from './types';

const TOKEN_STORAGE_KEY = 'sahayak.authToken';
const USER_STORAGE_KEY = 'sahayak.authUser';
const API_BASE = '/api';

@Injectable({ providedIn: 'root' })
export class AuthStore {
  private readonly router = inject(Router);

  /** Currently authenticated user. */
  readonly user = signal<AuthUser | null>(this.getStoredUser());

  /** Authenticated flag (true if token exists). */
  readonly authenticated = signal<boolean>(Boolean(this.token));

  constructor() {
    if (this.token) {
      void this.verifySession();
    }
  }

  get token(): string | null {
    try {
      return localStorage.getItem(TOKEN_STORAGE_KEY);
    } catch {
      return null;
    }
  }

  get role(): UserRole | null {
    return this.user()?.role ?? null;
  }

  hasRole(minimumRole: UserRole): boolean {
    const current = this.role;
    if (!current) return false;
    const rank: Record<UserRole, number> = { viewer: 1, editor: 2, admin: 3 };
    return rank[current] >= rank[minimumRole];
  }

  private getStoredUser(): AuthUser | null {
    try {
      const raw = localStorage.getItem(USER_STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  async verifySession(): Promise<boolean> {
    const token = this.token;
    if (!token) {
      this.clearSession();
      return false;
    }
    try {
      const response = await fetch(`${API_BASE}/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.ok) {
        const user = (await response.json()) as AuthUser;
        this.user.set(user);
        this.authenticated.set(true);
        localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(user));
        return true;
      }
    } catch {
      // Offline / network glitch: retain session if user data cached
      if (this.user()) return true;
    }
    this.clearSession();
    return false;
  }

  async login(username: string, password: string): Promise<void> {
    const response = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: username.trim(), password }),
    });

    if (!response.ok) {
      let errorMessage = 'Invalid credentials';
      try {
        const errorJson = await response.json();
        if (errorJson.error) errorMessage = errorJson.error;
      } catch {
        // Fallback
      }
      throw new Error(errorMessage);
    }

    const data = await response.json();
    if (!data.token) {
      throw new Error('Authentication response missing token');
    }

    localStorage.setItem(TOKEN_STORAGE_KEY, data.token);
    const user: AuthUser = data.user ?? { username: username.trim(), email: username.trim(), role: 'admin' };
    localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(user));
    this.user.set(user);
    this.authenticated.set(true);
  }

  logout(): void {
    this.clearSession();
    void this.router.navigate(['/login']);
  }

  clearSession(): void {
    try {
      localStorage.removeItem(TOKEN_STORAGE_KEY);
      localStorage.removeItem(USER_STORAGE_KEY);
    } catch {
      // Ignore
    }
    this.user.set(null);
    this.authenticated.set(false);
  }
}
