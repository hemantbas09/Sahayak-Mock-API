import { Component, input } from '@angular/core';

/**
 * Placeholder shown when a list has no items. Block: .empty-state
 */
@Component({
  selector: 'app-empty-state',
  imports: [],
  template: `
    @let title = titleInput();
    @let hint = hintInput();
    <div class="empty-state">
      <p class="empty-state__title">{{ title }}</p>
      @if (hint !== '') {
        <p class="empty-state__hint">{{ hint }}</p>
      }
    </div>
  `,
  styleUrl: './empty-state.scss',
})
export class EmptyState {
  readonly titleInput = input('Nothing here yet');
  readonly hintInput = input('');
}
