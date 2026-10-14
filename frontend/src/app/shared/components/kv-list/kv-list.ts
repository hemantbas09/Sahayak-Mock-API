import { Component, input, output } from '@angular/core';
import { KeyValue } from '../../../core/types';

/**
 * F3 — key/value row editor (headers, env defaults). Block: .kv-list
 *
 * Controlled component: renders `itemsInput` and emits the next full array
 * on every mutation. The parent binds both sides:
 *   [itemsInput]="headers" (itemsChange)="onHeaders($event)"
 *
 * Rows are tracked by index (KeyValue has no id; the editor list is stable
 * enough that index tracking keeps focus intact via uncontrolled [value]).
 */
@Component({
  selector: 'app-kv-list',
  template: `
    <div class="kv-list">
      @for (row of itemsInput(); track $index; let rowIndex = $index) {
        <div class="kv-list__row">
          <input
            class="kv-list__key"
            type="text"
            placeholder="{{ keyPlaceholderInput() }}"
            [value]="row.key"
            (change)="updateField(rowIndex, 'key', $event)"
          />
          <input
            class="kv-list__value"
            type="text"
            placeholder="{{ valuePlaceholderInput() }}"
            [value]="row.value"
            (change)="updateField(rowIndex, 'value', $event)"
          />
          <button class="kv-list__remove" type="button" title="Remove row" aria-label="Remove row" (click)="removeRow(rowIndex)">×</button>
        </div>
      } @empty {
        <p class="kv-list__empty">No rows yet.</p>
      }
      <button class="kv-list__add" type="button" (click)="addRow()">+ Add row</button>
    </div>
  `,
  styleUrl: './kv-list.scss',
})
export class KvList {
  readonly itemsInput = input<KeyValue[]>([]);
  readonly keyPlaceholderInput = input('Header name');
  readonly valuePlaceholderInput = input('Value');
  readonly itemsChange = output<KeyValue[]>();

  addRow(): void {
    this.emitNext([...this.itemsInput(), { key: '', value: '' }]);
  }

  updateField(rowIndex: number, field: 'key' | 'value', changeEvent: Event): void {
    const newValue = (changeEvent.target as HTMLInputElement).value;
    this.emitNext(
      this.itemsInput().map((row, index) => (index === rowIndex ? { ...row, [field]: newValue } : row)),
    );
  }

  removeRow(rowIndex: number): void {
    this.emitNext(this.itemsInput().filter((_, index) => index !== rowIndex));
  }

  private emitNext(nextItems: KeyValue[]): void {
    this.itemsChange.emit(nextItems);
  }
}
