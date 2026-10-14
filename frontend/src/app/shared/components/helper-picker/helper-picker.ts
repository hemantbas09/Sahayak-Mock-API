import { Component, output, signal } from '@angular/core';
import { ALL_HELPER_ENTRIES, HELPER_GROUPS, HelperEntry } from '../../../core/helper-catalog';
import { IconComponent } from '../icon/icon.component';

/**
 * Searchable helper cheat-sheet. Block: .helper-picker
 */
@Component({
  selector: 'app-helper-picker',
  imports: [IconComponent],
  template: `
    <span class="helper-picker">
      <button
        class="helper-picker__toggle"
        type="button"
        [class.helper-picker__toggle--open]="open()"
        [attr.aria-expanded]="open()"
        (click)="open.set(!open())"
      >
        <app-icon name="code" [size]="12" />
        <span>Template helpers</span>
      </button>

      @if (open()) {
        <div class="helper-picker__panel" role="dialog" aria-label="Template helpers">
          <input
            class="helper-picker__search"
            type="search"
            placeholder="Search helpers…"
            [value]="searchTerm()"
            (input)="searchTerm.set($any($event.target).value)"
          />
          <div class="helper-picker__results">
            @for (group of visibleGroups(); track group.id) {
              <p class="helper-picker__group-label">{{ group.label }}</p>
              @for (entry of group.entries; track entry.snippet) {
                <button
                  class="helper-picker__entry"
                  type="button"
                  (mousedown)="chooseEntry(entry)"
                  (click)="$event.preventDefault()"
                  [title]="entry.description"
                >
                  <code class="helper-picker__snippet">{{ entry.snippet }}</code>
                  <span class="helper-picker__desc">{{ entry.description }}</span>
                </button>
              }
            } @empty {
              <p class="helper-picker__none">No helpers match “{{ searchTerm() }}”.</p>
            }
          </div>
        </div>
      }
    </span>
  `,
  styleUrl: './helper-picker.scss',
})
export class HelperPicker {
  readonly insertSnippet = output<string>();
  readonly open = signal(false);
  readonly searchTerm = signal('');

  visibleGroups(): { id: string; label: string; entries: HelperEntry[] }[] {
    const needle = this.searchTerm().trim().toLowerCase();
    return HELPER_GROUPS.map((group) => ({
      ...group,
      entries: group.entries.filter(
        (entry) =>
          needle === '' ||
          entry.snippet.toLowerCase().includes(needle) ||
          entry.description.toLowerCase().includes(needle),
      ),
    })).filter((group) => group.entries.length > 0);
  }

  chooseEntry(entry: HelperEntry): void {
    this.open.set(false);
    this.insertSnippet.emit(entry.snippet);
  }

  get totalEntries(): number {
    return ALL_HELPER_ENTRIES.length;
  }
}
