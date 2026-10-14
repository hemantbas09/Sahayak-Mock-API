import { Component, computed, input, output, signal } from '@angular/core';
import { HttpMethod, ResponseMode, Route } from '../../../core/types';
import { createCrudRoute, createHttpRoute } from '../../../core/defaults';
import { IconComponent, IconName } from '../../../shared/components/icon/icon.component';

export interface ServiceCategory {
  id: string;
  label: string;
  icon: IconName;
  count: number;
}

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
        <button class="route-list__add-btn" type="button" title="Add new route" (click)="toggleAddMenu()">
          <app-icon name="plus" [size]="12" />
        </button>
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

        @if (showAddMenu()) {
          <div class="route-list__dropdown">
            <button type="button" (click)="addHttpRoute()">
              <app-icon name="plus" [size]="12" />
              <span>HTTP Route</span>
            </button>
            <button type="button" (click)="addCrudRoute()">
              <app-icon name="plus" [size]="12" />
              <span>CRUD Route</span>
            </button>
          </div>
        }
      </header>

      <!-- Quick Service Tabs / Modules in Sidebar -->
      @if (availableServices().length > 1) {
        <div class="route-list__services">
          @for (service of availableServices(); track service.id) {
            <button
              type="button"
              class="route-list__service-chip"
              [class.route-list__service-chip--active]="selectedService() === service.id"
              (click)="selectService(service.id)"
              [title]="service.label + ' (' + service.count + ' endpoints)'"
            >
              <app-icon [name]="service.icon" [size]="12" />
              <span class="route-list__service-label">{{ service.label }}</span>
              <span class="route-list__service-count">{{ service.count }}</span>
            </button>
          }
        </div>
      }

      <div class="route-list__items">
        @for (routeRow of filteredRoutes(); track routeRow.uuid; let routeIndex = $index) {
          <div
            class="route-list__item"
            [class.route-list__item--selected]="selectedUuidInput() === routeRow.uuid"
            (click)="selectChange.emit(routeRow.uuid)"
          >
            <div class="route-list__item-main">
              <span class="route-list__item-path">
                {{ routeRow.endpoint === '' ? '/' : (routeRow.endpoint.startsWith('/') ? routeRow.endpoint : '/' + routeRow.endpoint) }}
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
                  {{ routeRow.type === 'crud' ? 'CRUD' : routeRow.method.toUpperCase() }}
                </span>
                <span class="route-list__resp-count">
                  {{ routeRow.responses.length }} {{ routeRow.responses.length === 1 ? 'response' : 'responses' }}
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
            {{ filterText() ? 'No matching routes.' : 'No routes in this category.' }}
          </p>
        }
      </div>
    </div>
  `,
  styleUrl: './route-list.scss',
})
export class RouteList {
  readonly routesInput = input<Route[]>([]);
  readonly routesChange = output<Route[]>();
  readonly selectChange = output<string>();
  readonly selectedUuidInput = input<string | null>(null);

  readonly filterText = signal('');
  readonly selectedService = signal<string>('all');
  readonly showAddMenu = signal(false);

  readonly availableServices = computed<ServiceCategory[]>(() => {
    const routes = this.routesInput();
    const serviceDefs: { id: string; label: string; icon: IconName; match: (ep: string) => boolean }[] = [
      { id: 'card', label: 'Card Server', icon: 'card', match: (ep) => ep.includes('card') },
      { id: 'meroshare', label: 'MeroShare', icon: 'trending', match: (ep) => ep.includes('meroshare') },
      { id: 'customer', label: 'Customer & KYC', icon: 'user', match: (ep) => ep.includes('customer') || ep.includes('kyc') || ep.includes('custom') },
      { id: 'payment', label: 'Payments', icon: 'payment', match: (ep) => ep.includes('payment') || ep.includes('invoice') || ep.includes('bill') },
      { id: 'fonepay', label: 'Fonepay & IPS', icon: 'bank', match: (ep) => ep.includes('fonepay') || ep.includes('ips') || ep.includes('interbank') },
      { id: 'account', label: 'Accounts', icon: 'wallet', match: (ep) => ep.includes('account') || ep.includes('balance') || ep.includes('statement') },
      { id: 'notify', label: 'SMS & Alerts', icon: 'bell', match: (ep) => ep.includes('sms') || ep.includes('viber') || ep.includes('gcm') },
      { id: 'auth', label: 'Auth & Security', icon: 'lock', match: (ep) => ep.includes('admin') || ep.includes('security') || ep.includes('password') || ep.includes('activation') },
    ];

    const result: ServiceCategory[] = [{ id: 'all', label: 'All', icon: 'layers', count: routes.length }];

    for (const def of serviceDefs) {
      const count = routes.filter((r) => def.match(r.endpoint.toLowerCase())).length;
      if (count > 0) {
        result.push({
          id: def.id,
          label: def.label,
          icon: def.icon,
          count,
        });
      }
    }

    return result;
  });

  readonly filteredRoutes = computed(() => {
    const all = this.routesInput();
    const service = this.selectedService();
    const text = this.filterText().toLowerCase().trim();

    let matched = all;
    if (service !== 'all') {
      matched = matched.filter((r) => {
        const ep = r.endpoint.toLowerCase();
        switch (service) {
          case 'card': return ep.includes('card');
          case 'meroshare': return ep.includes('meroshare');
          case 'customer': return ep.includes('customer') || ep.includes('kyc') || ep.includes('custom');
          case 'payment': return ep.includes('payment') || ep.includes('invoice') || ep.includes('bill');
          case 'fonepay': return ep.includes('fonepay') || ep.includes('ips') || ep.includes('interbank');
          case 'account': return ep.includes('account') || ep.includes('balance') || ep.includes('statement');
          case 'notify': return ep.includes('sms') || ep.includes('viber') || ep.includes('gcm');
          case 'auth': return ep.includes('admin') || ep.includes('security') || ep.includes('password') || ep.includes('activation');
          default: return true;
        }
      });
    }

    if (!text) return matched;
    return matched.filter(
      (r) =>
        r.endpoint.toLowerCase().includes(text) ||
        r.method.toLowerCase().includes(text) ||
        (r.type === 'crud' && 'crud'.includes(text))
    );
  });

  selectService(serviceId: string): void {
    this.selectedService.set(serviceId);
    setTimeout(() => {
      const visible = this.filteredRoutes();
      const current = this.selectedUuidInput();
      if (visible.length > 0 && (!current || !visible.some((r) => r.uuid === current))) {
        this.selectChange.emit(visible[0].uuid);
      }
    }, 0);
  }

  onSearchInput(event: Event): void {
    const target = event.target as HTMLInputElement;
    this.filterText.set(target.value);
  }

  toggleAddMenu(): void {
    this.showAddMenu.update((v) => !v);
  }

  addHttpRoute(): void {
    this.showAddMenu.set(false);
    const newRoute = createHttpRoute('get', '/api/resource');
    this.emitRoutes([...this.routesInput(), newRoute]);
  }

  addCrudRoute(): void {
    this.showAddMenu.set(false);
    const newRoute = createCrudRoute('/api/items');
    this.emitRoutes([...this.routesInput(), newRoute]);
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
