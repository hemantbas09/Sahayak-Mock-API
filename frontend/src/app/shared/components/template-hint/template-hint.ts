import { Component, output } from '@angular/core';

/**
 * F5 — inline template hint. Block: .template-hint
 *
 * A compact row of quick-insert chips shown under body textareas, plus a
 * pointer to the full helper picker. Emits `insertSnippet` like the picker.
 */
@Component({
  selector: 'app-template-hint',
  template: `
    <div class="template-hint">
      <span class="template-hint__label">Templates:</span>
      @for (quickSnippet of quickSnippets; track quickSnippet.snippet) {
        <button
          class="template-hint__chip"
          type="button"
          (mousedown)="insertSnippet.emit(quickSnippet.snippet)"
          (click)="$event.preventDefault()"
          [title]="quickSnippet.description"
        >
          {{ quickSnippet.snippet }}
        </button>
      }
      <span class="template-hint__more">… or use the 🧩 Helpers button for the full list</span>
    </div>
  `,
  styleUrl: './template-hint.scss',
})
export class TemplateHint {
  readonly insertSnippet = output<string>();

  readonly quickSnippets = [
    { snippet: '{{faker.person.fullName}}', description: 'Random full name' },
    { snippet: '{{uuid}}', description: 'UUID v4' },
    { snippet: '{{queryParam "name"}}', description: 'Query value' },
    { snippet: '{{body "field"}}', description: 'Body field' },
    { snippet: '{{header "x-token"}}', description: 'Request header' },
    { snippet: '{{data "items" "0"}}', description: 'Data bucket value' },
  ];
}
