import { Component, input } from '@angular/core';

/**
 * Loading indicator. Block: .spinner
 */
@Component({
  selector: 'app-spinner',
  imports: [],
  template: `
    @let label = labelInput();
    <div class="spinner" role="status" aria-live="polite">
      <div class="spinner__ring"></div>
      @if (label !== '') {
        <span class="spinner__label">{{ label }}</span>
      }
    </div>
  `,
  styleUrl: './spinner.scss',
})
export class Spinner {
  /** Optional text shown under the ring. */
  readonly labelInput = input('');
}
