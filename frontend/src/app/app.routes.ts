import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'environments' },
  { path: 'login', redirectTo: 'environments' },
  {
    path: 'environments',
    loadComponent: () => import('./features/environments/environments').then((module) => module.Environments),
  },
  { path: '**', redirectTo: 'environments' },
];
