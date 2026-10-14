import { Component, input, output } from '@angular/core';

/**
 * Shared modal shell (F12/F15). Block: .modal
 *
 * Closes on backdrop click, Esc, or the panel's × button. The parent owns
 * visibility — the modal only reports `closed`.
 */
@Component({
  selector: 'app-modal',
  template: `
    <div class="modal" (click)="closeOnBackdrop($event)">
      <div class="modal__panel" role="dialog" aria-modal="true">
        <header class="modal__header">
          <h2 class="modal__title">{{ title() }}</h2>
          <button class="modal__close" type="button" aria-label="Close dialog" (click)="closed.emit()">×</button>
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
  /** Named `title` (not `titleInput`) so the static `title="…"` attribute on
   *  `<app-modal>` maps onto it — static attributes map to the input NAME. */
  readonly title = input('');
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
