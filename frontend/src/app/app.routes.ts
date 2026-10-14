import { Routes } from '@angular/router';
import { requireAuth } from './core/auth.guard';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'environments' },
  {
    path: 'login',
    loadComponent: () => import('./features/login/login').then((m) => m.Login),
  },
  {
    path: 'environments',
    canActivate: [requireAuth],
    loadComponent: () => import('./features/environments/environments').then((module) => module.Environments),
  },
  { path: '**', redirectTo: 'environments' },
];
