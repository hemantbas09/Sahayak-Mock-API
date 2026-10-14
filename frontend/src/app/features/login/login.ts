import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthStore } from '../../core/auth.store';

/**
 * F2 — login screen. Public route; a failed login just re-renders the
 * error, a success hands off to /environments.
 */
@Component({
  selector: 'app-login',
  imports: [FormsModule],
  templateUrl: './login.html',
  styleUrl: './login.scss',
})
export class Login {
  private readonly authStore = inject(AuthStore);
  private readonly router = inject(Router);

  readonly usernameInput = signal('');
  readonly passwordInput = signal('');
  readonly submitting = signal(false);
  readonly loginError = signal<string | null>(null);

  get loggedIn(): boolean {
    return this.authStore.authenticated();
  }

  async submitLogin(): Promise<void> {
    if (this.submitting()) return;
    this.loginError.set(null);
    this.submitting.set(true);
    try {
      await this.authStore.login(this.usernameInput(), this.passwordInput());
      await this.router.navigate(['/environments']);
    } catch (caught) {
      this.loginError.set(caught instanceof Error ? caught.message : 'Login failed');
    } finally {
      this.submitting.set(false);
    }
  }
}
