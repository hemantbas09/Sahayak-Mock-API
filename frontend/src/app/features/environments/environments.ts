import { Component, OnInit, inject, signal } from '@angular/core';
import { AuthStore } from '../../core/auth.store';
import { EnvironmentsStore } from '../../core/environments.store';
import {
  Environment,
  EnvironmentSummary,
  Route,
  RouteResponse,
  DataBucket,
} from '../../core/types';
import { EmptyState } from '../../shared/components/empty-state/empty-state';
import { RouteList } from './route-list/route-list';
import { RouteEditor } from './route-editor/route-editor';
import { ResponseList } from './response-list/response-list';
import { ResponseEditor } from './response-editor/response-editor';
import { DataBucketList } from './data-bucket-list/data-bucket-list';
import { DataBucketEditor } from './data-bucket-editor/data-bucket-editor';
import { LogViewer } from './log-viewer/log-viewer';
import { EnvSettings } from './env-settings/env-settings';
import { ImportExport } from './import-export/import-export';

/**
 * F7 + F14 — environments page: sidebar (env list) + save bar + tabbed
 * editor (Routes / Data / Logs) + settings & import/export modals.
 *
 * All editor components are controlled: they render store signals and emit
 * the next document shape, which the shell applies through
 * `EnvironmentsStore.update()` — the single dirty-tracking entry point.
 */
@Component({
  selector: 'app-environments',
  imports: [
    EmptyState,
    RouteList,
    RouteEditor,
    ResponseList,
    ResponseEditor,
    DataBucketList,
    DataBucketEditor,
    LogViewer,
    EnvSettings,
    ImportExport,
  ],
  templateUrl: './environments.html',
  styleUrl: './environments.scss',
})
export class Environments implements OnInit {
  private readonly envStore = inject(EnvironmentsStore);
  private readonly authStore = inject(AuthStore);

  // --- UI state ----------------------------------------------------------

  readonly activeTab = signal<'routes' | 'data' | 'logs'>('routes');
  readonly selectedRouteUuid = signal<string | null>(null);
  readonly selectedResponseUuid = signal<string | null>(null);
  readonly selectedBucketUuid = signal<string | null>(null);
  readonly showSettings = signal(false);
  readonly showImport = signal(false);

  // --- store signals exposed to the template -------------------------------

  readonly list = this.envStore.list;
  readonly current = this.envStore.current;
  readonly selectedUuid = this.envStore.selectedUuid;
  readonly dirty = this.envStore.dirty;
  readonly saving = this.envStore.saving;
  readonly saveError = this.envStore.saveError;
  readonly conflictInfo = this.envStore.conflictInfo;

  ngOnInit(): void {
    void this.envStore.refreshList().then(() => {
      const firstEnvironment = this.envStore.list()[0];
      if (firstEnvironment) void this.envStore.selectEnvironment(firstEnvironment.uuid);
    });
  }

  // --- sidebar actions ---------------------------------------------------

  selectEnvironmentRow(summary: EnvironmentSummary): void {
    this.resetSelection();
    void this.envStore.selectEnvironment(summary.uuid);
  }

  createEnvironmentRow(): void {
    void this.envStore.createEnvironment();
  }

  deleteEnvironmentRow(summary: EnvironmentSummary): void {
    if (window.confirm(`Delete environment "${summary.name}"? This cannot be undone.`)) {
      void this.envStore.deleteEnvironment(summary.uuid);
    }
  }

  duplicateEnvironmentRow(summary: EnvironmentSummary): void {
    void this.envStore.duplicateEnvironment(summary.uuid);
  }

  // --- save bar ------------------------------------------------------------

  saveCurrent(): void {
    void this.envStore.saveCurrent();
  }

  discardChanges(): void {
    void this.envStore.discardChanges();
  }

  reloadLatestVersion(): void {
    void this.envStore.reloadLatest();
  }

  dismissConflictBanner(): void {
    this.envStore.dismissConflict();
  }

  // --- tab helpers -----------------------------------------------------------

  switchTab(tab: 'routes' | 'data' | 'logs'): void {
    this.activeTab.set(tab);
  }

  // --- document mutation handlers (controlled-component inputs) -------------

  applyRoutes(nextRoutes: Route[]): void {
    this.envStore.update((draftEnvironment) => {
      draftEnvironment.routes = nextRoutes;
    });
    // Keep the selected route valid after deletes/reorders.
    if (this.selectedRouteUuid() && !nextRoutes.some((route) => route.uuid === this.selectedRouteUuid())) {
      this.selectedRouteUuid.set(nextRoutes[0]?.uuid ?? null);
    }
  }

  applyRoute(nextRoute: Route): void {
    this.envStore.update((draftEnvironment) => {
      const replaceIndex = draftEnvironment.routes.findIndex((route) => route.uuid === nextRoute.uuid);
      if (replaceIndex >= 0) draftEnvironment.routes[replaceIndex] = nextRoute;
    });
  }

  applyResponses(routeUuid: string, nextResponses: RouteResponse[]): void {
    this.envStore.update((draftEnvironment) => {
      const targetRoute = draftEnvironment.routes.find((route) => route.uuid === routeUuid);
      if (targetRoute) targetRoute.responses = nextResponses;
    });
    if (
      this.selectedResponseUuid() &&
      !nextResponses.some((response) => response.uuid === this.selectedResponseUuid())
    ) {
      this.selectedResponseUuid.set(nextResponses[0]?.uuid ?? null);
    }
  }

  applyResponse(nextResponse: RouteResponse): void {
    this.envStore.update((draftEnvironment) => {
      for (const draftRoute of draftEnvironment.routes) {
        const replaceIndex = draftRoute.responses.findIndex((response) => response.uuid === nextResponse.uuid);
        if (replaceIndex >= 0) {
          draftRoute.responses[replaceIndex] = nextResponse;
          break;
        }
      }
    });
  }

  applyBuckets(nextBuckets: DataBucket[]): void {
    const previousBuckets = this.current()?.data ?? [];
    const newlyAdded = nextBuckets.find(
      (bucket) => !previousBuckets.some((existingBucket) => existingBucket.uuid === bucket.uuid),
    );
    this.envStore.update((draftEnvironment) => {
      draftEnvironment.data = nextBuckets;
    });
    if (newlyAdded) {
      this.selectedBucketUuid.set(newlyAdded.uuid);
    } else if (
      this.selectedBucketUuid() &&
      !nextBuckets.some((bucket) => bucket.uuid === this.selectedBucketUuid())
    ) {
      this.selectedBucketUuid.set(nextBuckets[0]?.uuid ?? null);
    }
  }

  applyBucket(nextBucket: DataBucket): void {
    this.envStore.update((draftEnvironment) => {
      const replaceIndex = draftEnvironment.data.findIndex((bucket) => bucket.uuid === nextBucket.uuid);
      if (replaceIndex >= 0) draftEnvironment.data[replaceIndex] = nextBucket;
    });
  }

  applySettings(nextEnvironment: Environment): void {
    this.envStore.update((draftEnvironment) => {
      // Only the settings fields change — keep routes/data as-is.
      draftEnvironment.name = nextEnvironment.name;
      draftEnvironment.port = nextEnvironment.port;
      draftEnvironment.endpointPrefix = nextEnvironment.endpointPrefix;
      draftEnvironment.headers = nextEnvironment.headers;
      draftEnvironment.proxyMode = nextEnvironment.proxyMode;
      draftEnvironment.proxyHost = nextEnvironment.proxyHost;
      draftEnvironment.proxyRemovePrefix = nextEnvironment.proxyRemovePrefix;
      draftEnvironment.tlsOptions = nextEnvironment.tlsOptions;
    });
  }

  onImported(): void {
    void this.envStore.refreshList();
  }

  // --- derived lookups ----------------------------------------------------

  selectedRoute(): Route | null {
    const currentEnvironment = this.current();
    if (!currentEnvironment || !this.selectedRouteUuid()) return null;
    return currentEnvironment.routes.find((route) => route.uuid === this.selectedRouteUuid()) ?? null;
  }

  selectedResponse(): RouteResponse | null {
    const activeRoute = this.selectedRoute();
    if (!activeRoute || !this.selectedResponseUuid()) return null;
    return activeRoute.responses.find((response) => response.uuid === this.selectedResponseUuid()) ?? null;
  }

  selectedBucket(): DataBucket | null {
    const currentEnvironment = this.current();
    if (!currentEnvironment || !this.selectedBucketUuid()) return null;
    return currentEnvironment.data.find((bucket) => bucket.uuid === this.selectedBucketUuid()) ?? null;
  }

  /** uuids referenced by responses (databucketId) — for delete warnings. */
  bucketReferences(): string[] {
    const currentEnvironment = this.current();
    if (!currentEnvironment) return [];
    return currentEnvironment.routes.flatMap((route) =>
      route.responses.map((response) => response.databucketId),
    ).filter((reference) => reference !== '');
  }

  // --- selection wiring ------------------------------------------------------

  onRouteSelected(routeUuid: string): void {
    this.selectedRouteUuid.set(routeUuid);
    const targetRoute = this.current()?.routes.find((route) => route.uuid === routeUuid);
    this.selectedResponseUuid.set(targetRoute?.responses[0]?.uuid ?? null);
  }

  onRouteListChanged(nextRoutes: Route[]): void {
    const previousRoutes = this.current()?.routes ?? [];
    const newlyAdded = nextRoutes.find(
      (route) => !previousRoutes.some((existingRoute) => existingRoute.uuid === route.uuid),
    );
    this.applyRoutes(nextRoutes);
    // When a route was just added, focus its editor.
    if (newlyAdded) this.onRouteSelected(newlyAdded.uuid);
  }

  onResponseSelected(responseUuid: string): void {
    this.selectedResponseUuid.set(responseUuid);
  }

  /** The log viewer's admin-only clear button. */
  canClearLogs(): boolean {
    return this.authStore.hasRole('admin');
  }

  onDataTabShown(nextBuckets: DataBucket[]): void {
    // Keep a bucket selected whenever the data tab is visible.
    if (nextBuckets.length > 0 && !this.selectedBucketUuid()) {
      this.selectedBucketUuid.set(nextBuckets[0].uuid);
    }
  }

  private resetSelection(): void {
    this.selectedRouteUuid.set(null);
    this.selectedResponseUuid.set(null);
    this.selectedBucketUuid.set(null);
    this.activeTab.set('routes');
  }
}
