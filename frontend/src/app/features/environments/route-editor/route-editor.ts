import { Component, input, output } from '@angular/core';
import { HttpMethod, Route } from '../../../core/types';
import { SelectValueSync } from '../../../shared/directives/select-value-sync.directive';

/**
 * F9 — route detail editor (endpoint, method, documentation).
 * Block: .route-editor
 *
 * Controlled single-item editor: renders `routeInput` and emits the mutated
 * clone on every field change (`routeChange`).
 */
@Component({
  selector: 'app-route-editor',
  imports: [SelectValueSync],
  template: `
    @if (routeInput(); as activeRoute) {
      <div class="route-editor">
      <header class="route-editor__head">
        <h3 class="route-editor__heading">Route details</h3>
        <span class="route-editor__type-badge">{{ activeRoute.type === 'crud' ? 'CRUD' : 'HTTP' }}</span>
      </header>

      <div class="route-editor__grid">
        <div class="route-editor__field route-editor__field--half">
          <span class="route-editor__label">Endpoint</span>
          <input
            class="route-editor__endpoint-input"
            type="text"
            placeholder="/users/:id"
            [value]="activeRoute.endpoint"
            (change)="setField('endpoint', $event)"
          />
        </div>

        <div class="route-editor__field route-editor__field--quarter">
          <span class="route-editor__label">Method</span>
          <select
            class="route-editor__method"
            [value]="activeRoute.method"
            [syncSelectValue]="activeRoute.method"
            (change)="setField('method', $event)"
          >
            @for (methodOption of methodOptions; track methodOption) {
              <option [value]="methodOption">{{ methodOption.toUpperCase() }}</option>
            }
          </select>
        </div>

        <div class="route-editor__field">
          <span class="route-editor__label">Documentation</span>
          <textarea
            class="route-editor__docs"
            rows="3"
            placeholder="What does this route mock?"
            [value]="activeRoute.documentation"
            (change)="setField('documentation', $event)"
          ></textarea>
        </div>
      </div>
      </div>
    }
  `,
  styleUrl: './route-editor.scss',
})
export class RouteEditor {
  readonly routeInput = input<Route | null>(null);
  readonly routeChange = output<Route>();

  readonly methodOptions: HttpMethod[] = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'];

  setField(field: 'endpoint' | 'method' | 'documentation', changeEvent: Event): void {
    const sourceRoute = this.routeInput();
    if (!sourceRoute) return;
    const nextValue = (changeEvent.target as HTMLInputElement | HTMLSelectElement).value;
    this.routeChange.emit({
      ...sourceRoute,
      [field]: field === 'method' ? (nextValue as HttpMethod) : nextValue,
    });
  }
}
