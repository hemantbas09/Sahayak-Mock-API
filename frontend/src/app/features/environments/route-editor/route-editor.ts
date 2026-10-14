import { Component, input, output } from '@angular/core';
import { DataBucket, HttpMethod, Route } from '../../../core/types';
import { SelectValueSync } from '../../../shared/directives/select-value-sync.directive';

/**
 * F9 — route detail editor (endpoint, method, documentation, CRUD bucket).
 * Block: .route-editor
 *
 * Controlled single-item editor: renders `routeInput` and emits the mutated
 * clone on every field change (`routeChange`). CRUD routes link their
 * source data bucket via `responses[0].databucketId`.
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

        @if (activeRoute.type === 'http') {
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
        } @else {
          <div class="route-editor__field">
            <span class="route-editor__label">Data bucket</span>
            <select
              class="route-editor__bucket"
              [value]="linkedBucketUuid()"
              [syncSelectValue]="linkedBucketUuid()"
              (change)="setLinkedBucket($event)"
            >
              <option value="" disabled>Select bucket…</option>
              @for (bucket of bucketsInput(); track bucket.uuid) {
                <option [value]="bucket.uuid">{{ bucket.name }}</option>
              }
            </select>
            <p class="route-editor__hint">
              CRUD dispatch: GET list · GET :id · POST create · PUT/PATCH update · DELETE remove.
              @if (bucketsInput().length === 0) {
                Add a data bucket first (Data tab).
              }
            </p>
          </div>
        }

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
  readonly bucketsInput = input<DataBucket[]>([]);
  readonly routeChange = output<Route>();

  readonly methodOptions: HttpMethod[] = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'];

  /** uuid of the bucket linked via responses[0].databucketId. */
  linkedBucketUuid(): string {
    return this.routeInput()?.responses[0]?.databucketId ?? '';
  }

  /** True when the route has no responses to carry a bucket link. */
  hasNoResponses(): boolean {
    const route = this.routeInput();
    return !route || route.responses.length === 0;
  }

  setField(field: 'endpoint' | 'method' | 'documentation', changeEvent: Event): void {
    const sourceRoute = this.routeInput();
    if (!sourceRoute) return;
    const nextValue = (changeEvent.target as HTMLInputElement | HTMLSelectElement).value;
    this.routeChange.emit({
      ...sourceRoute,
      [field]: field === 'method' ? (nextValue as HttpMethod) : nextValue,
    });
  }

  setLinkedBucket(changeEvent: Event): void {
    const sourceRoute = this.routeInput();
    if (!sourceRoute || sourceRoute.responses.length === 0) return;
    const bucketUuid = (changeEvent.target as HTMLSelectElement).value;
    this.routeChange.emit({
      ...sourceRoute,
      responses: sourceRoute.responses.map((sourceResponse, responseIndex) =>
        responseIndex === 0 ? { ...sourceResponse, databucketId: bucketUuid } : sourceResponse,
      ),
    });
  }
}
