import { Component } from '@angular/core';
import { EmptyState } from './shared/components/empty-state/empty-state';
import { Spinner } from './shared/components/spinner/spinner';

@Component({
  selector: 'app-root',
  imports: [EmptyState, Spinner],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {}
