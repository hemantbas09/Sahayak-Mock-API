import { ChangeDetectorRef, Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { HttpMethod, ResponseMode, Route } from '../../../core/types';
import { createHttpRoute } from '../../../core/defaults';
import { IconComponent } from '../../../shared/components/icon/icon.component';

/**
 * Route list component for the sidebar.
 * Block: .route-list
 */
@Component({
  selector: 'app-route-list',
  imports: [IconComponent],
  template: `
    <div class="route-list">
      <header class="route-list__toolbar">
        <div class="route-list__search-wrap">
          <span class="route-list__search-icon">
            <app-icon name="search" [size]="12" />
          </span>
          <input
            type="text"
            class="route-list__search-input"
            placeholder="Filter routes..."
            [value]="filterText()"
            (input)="onSearchInput($event)"
          />
        </div>
        <button class="route-list__add-btn" type="button" title="Add HTTP route" (click)="addHttpRoute()">
          <app-icon name="plus" [size]="12" />
        </button>
      </header>

      <div class="route-list__items">
        @for (routeRow of filteredRoutes(); track routeRow.uuid; let routeIndex = $index) {
          <div
            class="route-list__item"
            [class.route-list__item--selected]="selectedUuidInput() === routeRow.uuid"
            (click)="selectChange.emit(routeRow.uuid)"
          >
            <div class="route-list__item-main">
              <span class="route-list__item-path">
                {{ !routeRow.endpoint ? '/' : (routeRow.endpoint.startsWith('/') ? routeRow.endpoint : '/' + routeRow.endpoint) }}
              </span>
              <div class="route-list__item-meta">
                <span
                  class="route-list__method-badge"
                  [class.route-list__method-badge--get]="routeRow.type === 'http' && routeRow.method === 'get'"
                  [class.route-list__method-badge--post]="routeRow.type === 'http' && routeRow.method === 'post'"
                  [class.route-list__method-badge--put]="routeRow.type === 'http' && routeRow.method === 'put'"
                  [class.route-list__method-badge--delete]="routeRow.type === 'http' && routeRow.method === 'delete'"
                  [class.route-list__method-badge--patch]="routeRow.type === 'http' && routeRow.method === 'patch'"
                  [class.route-list__method-badge--crud]="routeRow.type === 'crud'"
                >
                  {{ routeRow.type === 'crud' ? 'CRUD' : (routeRow.method || 'GET').toUpperCase() }}
                </span>
                <span class="route-list__resp-count">
                  {{ routeRow.responses?.length || 0 }} {{ (routeRow.responses?.length === 1) ? 'response' : 'responses' }}
                </span>
              </div>
            </div>

            <div class="route-list__item-actions" (click)="$event.stopPropagation()">
              <button type="button" title="Duplicate route" (click)="duplicateRoute(routeRow)">
                <app-icon name="copy" [size]="12" />
              </button>
              <button type="button" title="Delete route" class="route-list__delete-btn" (click)="deleteRoute(routeRow)">
                <app-icon name="trash" [size]="12" />
              </button>
            </div>
          </div>
        } @empty {
          <p class="route-list__empty">
            {{ filterText() ? 'No matching routes.' : 'No routes configured.' }}
          </p>
        }
      </div>
    </div>
  `,
  styleUrl: './route-list.scss',
})
export class RouteList {
  private readonly cdr = inject(ChangeDetectorRef);
  readonly routesInput = input<Route[]>([]);
  readonly routesChange = output<Route[]>();
  readonly selectChange = output<string>();
  readonly selectedUuidInput = input<string | null>(null);

  readonly filterText = signal('');

  readonly filteredRoutes = computed(() => {
    const all = this.routesInput() || [];
    const text = this.filterText().toLowerCase().trim();
    if (!text) return all;
    return all.filter(
      (r) =>
        (r.endpoint || '').toLowerCase().includes(text) ||
        (r.method || '').toLowerCase().includes(text) ||
        (r.type === 'crud' && 'crud'.includes(text))
    );
  });

  constructor() {
    effect(() => {
      this.routesInput();
      this.filterText();
      this.cdr.markForCheck();
    });
  }

  onSearchInput(event: Event): void {
    const target = event.target as HTMLInputElement;
    this.filterText.set(target.value);
  }

  addHttpRoute(): void {
    const newRoute = createHttpRoute('get', '');
    this.emitRoutes([...this.routesInput(), newRoute]);
    this.selectChange.emit(newRoute.uuid);
  }

  duplicateRoute(route: Route): void {
    const originalIndex = this.routesInput().findIndex((r) => r.uuid === route.uuid);
    if (originalIndex === -1) return;
    const clone: Route = {
      ...structuredClone(route),
      uuid: crypto.randomUUID(),
      endpoint: `${route.endpoint}-copy`,
      responses: route.responses.map((resp) => ({ ...structuredClone(resp), uuid: crypto.randomUUID() })),
    };
    const next = [...this.routesInput()];
    next.splice(originalIndex + 1, 0, clone);
    this.emitRoutes(next);
  }

  deleteRoute(route: Route): void {
    this.emitRoutes(this.routesInput().filter((r) => r.uuid !== route.uuid));
  }

  private emitRoutes(routes: Route[]): void {
    this.routesChange.emit(routes);
  }
}
