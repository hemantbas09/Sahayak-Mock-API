import { Component, input, output } from '@angular/core';
import { IconComponent } from '../icon/icon.component';

/**
 * Shared modal shell (F12/F15). Block: .modal
 */
@Component({
  selector: 'app-modal',
  imports: [IconComponent],
  template: `
    <div class="modal" (click)="closeOnBackdrop($event)">
      <div class="modal__panel modal__panel--{{ size() }}" role="dialog" aria-modal="true">
        <header class="modal__header">
          <h2 class="modal__title">{{ title() }}</h2>
          <button class="modal__close" type="button" aria-label="Close dialog" (click)="closed.emit()">
            <app-icon name="close" [size]="14" />
          </button>
        </header>
        <div class="modal__body">
          <ng-content />
        </div>
      </div>
    </div>
  `,
  host: {
    '(document:keydown.escape)': 'onEscapeKey()',
  },
  styleUrl: './modal.scss',
})
export class Modal {
  readonly title = input('');
  readonly size = input<'sm' | 'md' | 'lg' | 'xl'>('md');
  readonly closed = output<void>();

  closeOnBackdrop(backdropEvent: Event): void {
    if (backdropEvent.target === backdropEvent.currentTarget) {
      this.closed.emit();
    }
  }

  onEscapeKey(): void {
    this.closed.emit();
  }
}
