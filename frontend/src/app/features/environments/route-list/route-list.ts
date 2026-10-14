import { Component, input, output } from '@angular/core';
import { ResponseMode, Route } from '../../../core/types';
import { createCrudRoute, createHttpRoute } from '../../../core/defaults';

/**
 * F8 — route list. Block: .route-list
 *
 * Controlled list editor: renders `routesInput` in declaration order and
 * emits the next full array on every structural mutation (add, duplicate,
 * delete, reorder). Field edits (endpoint, mode…) flow through the
 * `routeChange` output with the mutated clone.
 */
@Component({
  selector: 'app-route-list',
  template: `
    <div class="route-list">
      <header class="route-list__head">
        <h3 class="route-list__heading">Routes</h3>
        <span class="route-list__actions">
          <button class="route-list__add" type="button" (click)="addHttpRoute()">+ HTTP route</button>
          <button class="route-list__add" type="button" (click)="addCrudRoute()">+ CRUD route</button>
        </span>
      </header>

      @for (routeRow of routesInput(); track routeRow.uuid; let routeIndex = $index) {
        <div
          class="route-list__row"
          [class.route-list__row--selected]="selectedUuidInput() === routeRow.uuid"
        >
          <span class="route-list__order">{{ routeIndex + 1 }}</span>

          <button
            class="route-list__badge"
            type="button"
            [class.route-list__badge--crud]="routeRow.type === 'crud'"
            [attr.title]="'click to edit this route'"
            (click)="selectChange.emit(routeRow.uuid)"
          >
            {{ routeRow.type === 'crud' ? 'CRUD' : routeRow.method.toUpperCase() }}
          </button>

          <button
            class="route-list__endpoint"
            type="button"
            (click)="selectChange.emit(routeRow.uuid)"
          >
            {{ routeRow.endpoint === '' ? '(no endpoint yet)' : routeRow.endpoint }}
          </button>

          <span class="route-list__resp-count">{{ routeRow.responses.length }} resp</span>

          <select
            class="route-list__mode"
            [value]="routeRow.responseMode ?? ''"
            (change)="setResponseMode(routeRow, $event)"
            [attr.title]="'response selection mode: null = rules'"
          >
            <option value="">rules</option>
            <option value="RANDOM">random</option>
            <option value="SEQUENTIAL">sequential</option>
          </select>

          <span class="route-list__row-actions">
            <button
              type="button"
              title="Move up"
              [disabled]="routeIndex === 0"
              (click)="moveRoute(routeIndex, -1)"
            >↑</button>
            <button
              type="button"
              title="Move down"
              [disabled]="routeIndex === routesInput().length - 1"
              (click)="moveRoute(routeIndex, 1)"
            >↓</button>
            <button type="button" title="Duplicate route" (click)="duplicateRoute(routeRow)">⧉</button>
            <button
              type="button"
              title="Delete route"
              class="route-list__delete"
              (click)="deleteRoute(routeRow)"
            >🗑</button>
          </span>
        </div>
      } @empty {
        <p class="route-list__empty">No routes yet — add an HTTP or CRUD route to start mocking.</p>
      }
    </div>
  `,
  styleUrl: './route-list.scss',
})
export class RouteList {
  readonly routesInput = input<Route[]>([]);
  readonly routesChange = output<Route[]>();
  /** Route whose editor panel should be focused (badge/endpoint click). */
  readonly selectChange = output<string>();
  /** Highlighted row (the one open in the editor). */
  readonly selectedUuidInput = input<string | null>(null);

  addHttpRoute(): void {
    const newRoute = createHttpRoute('get', '');
    this.emitRoutes([...this.routesInput(), newRoute]);
    this.selectChange.emit(newRoute.uuid);
  }

  addCrudRoute(): void {
    const newRoute = createCrudRoute('');
    this.emitRoutes([...this.routesInput(), newRoute]);
    this.selectChange.emit(newRoute.uuid);
  }

  duplicateRoute(sourceRoute: Route): void {
    const cloneRoute = structuredClone(sourceRoute);
    // Fresh uuids everywhere in the clone so nothing collides with the source.
    cloneRoute.uuid = crypto.randomUUID();
    cloneRoute.responses = cloneRoute.responses.map((sourceResponse) => ({
      ...sourceResponse,
      uuid: crypto.randomUUID(),
      defaultResponse: false,
    }));
    const insertIndex = this.routesInput().findIndex((routeRow) => routeRow.uuid === sourceRoute.uuid);
    const nextRoutes = [...this.routesInput()];
    nextRoutes.splice(insertIndex + 1, 0, cloneRoute);
    this.emitRoutes(nextRoutes);
    this.selectChange.emit(cloneRoute.uuid);
  }

  deleteRoute(routeRow: Route): void {
    if (!window.confirm(`Delete route "${routeRow.endpoint || '(unnamed)'}"? Its responses go with it.`)) return;
    this.emitRoutes(this.routesInput().filter((otherRoute) => otherRoute.uuid !== routeRow.uuid));
  }

  moveRoute(fromIndex: number, direction: -1 | 1): void {
    const toIndex = fromIndex + direction;
    const sourceRoutes = this.routesInput();
    if (toIndex < 0 || toIndex >= sourceRoutes.length) return;
    const nextRoutes = [...sourceRoutes];
    const [movedRoute] = nextRoutes.splice(fromIndex, 1);
    nextRoutes.splice(toIndex, 0, movedRoute);
    this.emitRoutes(nextRoutes);
  }

  setResponseMode(routeRow: Route, changeEvent: Event): void {
    const rawValue = (changeEvent.target as HTMLSelectElement).value;
    const nextMode: ResponseMode = rawValue === 'RANDOM' ? 'RANDOM' : rawValue === 'SEQUENTIAL' ? 'SEQUENTIAL' : null;
    this.emitRoutes(
      this.routesInput().map((existingRoute) =>
        existingRoute.uuid === routeRow.uuid ? { ...existingRoute, responseMode: nextMode } : existingRoute,
      ),
    );
  }

  private emitRoutes(nextRoutes: Route[]): void {
    this.routesChange.emit(nextRoutes);
  }
}
