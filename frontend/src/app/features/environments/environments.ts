import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { AuthStore } from '../../core/auth.store';
import { EnvironmentsStore } from '../../core/environments.store';
import { MockApiClient } from '../../core/mock-api.client';
import { downloadJson } from '../../core/utils';
import {
  Environment,
  EnvironmentSummary,
  Route,
  RouteResponse,
  DataBucket,
} from '../../core/types';
import { RouteList } from './route-list/route-list';
import { ResponseEditor } from './response-editor/response-editor';
import { DataBucketList } from './data-bucket-list/data-bucket-list';
import { DataBucketEditor } from './data-bucket-editor/data-bucket-editor';
import { LogViewer } from './log-viewer/log-viewer';
import { EnvSettings } from './env-settings/env-settings';
import { KvList } from '../../shared/components/kv-list/kv-list';
import { IconComponent } from '../../shared/components/icon/icon.component';

/**
 * Environments page: Supports both the "Projects Dashboard" (Screenshot 1)
 * and the "Project Studio / Editor" (Screenshot 2).
 */
@Component({
  selector: 'app-environments',
  imports: [
    RouteList,
    ResponseEditor,
    DataBucketList,
    DataBucketEditor,
    LogViewer,
    EnvSettings,
    KvList,
    IconComponent,
  ],
  templateUrl: './environments.html',
  styleUrl: './environments.scss',
})
export class Environments implements OnInit {
  private readonly envStore = inject(EnvironmentsStore);
  private readonly authStore = inject(AuthStore);
  private readonly apiClient = inject(MockApiClient);

  // --- View mode: Dashboard (Screenshot 1) vs Studio (Screenshot 2) ---
  readonly viewMode = signal<'dashboard' | 'studio'>('dashboard');
  readonly dashboardTab = signal<'all' | 'active' | 'paused'>('all');
  readonly searchQuery = signal('');
  readonly copiedUuid = signal<string | null>(null);

  // --- UI state inside Studio ---
  readonly activeTab = signal<'routes' | 'data' | 'headers' | 'logs' | 'proxy' | 'settings'>('routes');
  readonly selectedRouteUuid = signal<string | null>(null);
  readonly selectedResponseUuid = signal<string | null>(null);
  readonly selectedBucketUuid = signal<string | null>(null);
  readonly showSettings = signal(false);
  readonly isImporting = signal(false);

  // --- Store signals ---
  readonly list = this.envStore.list;
  readonly current = this.envStore.current;
  readonly selectedUuid = this.envStore.selectedUuid;
  readonly dirty = this.envStore.dirty;
  readonly saving = this.envStore.saving;
  readonly saveError = this.envStore.saveError;
  readonly conflictInfo = this.envStore.conflictInfo;
  readonly currentUser = this.authStore.user;

  // --- Computed stats for Dashboard ---
  readonly activeCount = computed(
    () => this.list().filter((e) => e.listener === 'listening').length
  );
  readonly pausedCount = computed(
    () => this.list().filter((e) => e.listener !== 'listening').length
  );

  readonly filteredList = computed(() => {
    const query = this.searchQuery().toLowerCase().trim();
    const tab = this.dashboardTab();
    return this.list().filter((env) => {
      if (tab === 'active' && env.listener !== 'listening') return false;
      if (tab === 'paused' && env.listener === 'listening') return false;
      if (!query) return true;
      return (
        env.name.toLowerCase().includes(query) ||
        String(env.port).includes(query) ||
        env.endpointPrefix.toLowerCase().includes(query)
      );
    });
  });

  ngOnInit(): void {
    void this.envStore.refreshList().then(() => {
      const firstEnvironment = this.envStore.list()[0];
      if (firstEnvironment) {
        void this.envStore.selectEnvironment(firstEnvironment.uuid).then(() => {
          this.syncFirstRoute();
        });
      }
    });
  }

  // --- Dashboard actions ---

  openInStudio(summary: EnvironmentSummary): void {
    this.resetSelection();
    void this.envStore.selectEnvironment(summary.uuid).then(() => {
      this.syncFirstRoute();
      this.viewMode.set('studio');
    });
  }

  backToDashboard(): void {
    this.viewMode.set('dashboard');
  }

  copyUrl(summaryOrEnv: EnvironmentSummary | Environment, event?: MouseEvent): void {
    event?.stopPropagation();
    const prefix = summaryOrEnv.endpointPrefix ? (summaryOrEnv.endpointPrefix.startsWith('/') ? summaryOrEnv.endpointPrefix : '/' + summaryOrEnv.endpointPrefix) : '';
    const url = `http://localhost:${summaryOrEnv.port}${prefix}`;
    navigator.clipboard.writeText(url).then(() => {
      this.copiedUuid.set(summaryOrEnv.uuid);
      setTimeout(() => this.copiedUuid.set(null), 2000);
    });
  }

  openSettingsModal(summary: EnvironmentSummary, event?: MouseEvent): void {
    event?.stopPropagation();
    void this.envStore.selectEnvironment(summary.uuid).then(() => {
      this.showSettings.set(true);
    });
  }

  // --- Environment actions ---

  selectEnvironmentRow(summary: EnvironmentSummary): void {
    this.resetSelection();
    void this.envStore.selectEnvironment(summary.uuid).then(() => {
      this.syncFirstRoute();
    });
  }

  createEnvironmentRow(): void {
    void this.envStore.createEnvironment().then(() => {
      const created = this.envStore.current();
      if (created) {
        this.resetSelection();
        this.syncFirstRoute();
        this.viewMode.set('studio');
      }
    });
  }

  deleteEnvironmentRow(summary: EnvironmentSummary, event?: MouseEvent): void {
    event?.stopPropagation();
    if (window.confirm(`Delete environment "${summary.name}"? This cannot be undone.`)) {
      void this.envStore.deleteEnvironment(summary.uuid);
    }
  }

  duplicateEnvironmentRow(summary: EnvironmentSummary, event?: MouseEvent): void {
    event?.stopPropagation();
    void this.envStore.duplicateEnvironment(summary.uuid);
  }

  async exportEnvironmentRow(target: { uuid: string; name: string }, event?: MouseEvent): Promise<void> {
    event?.stopPropagation();
    try {
      const blob = await this.apiClient.exportEnvironment(target.uuid);
      const text = await blob.text();
      const safeName =
        (target.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'environment') +
        '.mockoon.json';
      downloadJson(safeName, text);
    } catch {
      // export error handled
    }
  }

  async onFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    this.isImporting.set(true);
    try {
      const result = await this.apiClient.importFile(file);
      await this.envStore.refreshList();
      const firstImported = result.imported[0];
      if (firstImported) {
        await this.envStore.selectEnvironment(firstImported.uuid);
        this.resetSelection();
        this.syncFirstRoute();
        this.viewMode.set('studio');
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Import failed');
    } finally {
      this.isImporting.set(false);
      input.value = '';
    }
  }

  addResponse(routeUuid: string): void {
    const route = this.selectedRoute();
    if (!route) return;
    const newResponse: RouteResponse = {
      uuid: crypto.randomUUID(),
      label: `Response ${route.responses.length + 1}`,
      statusCode: 200,
      headers: [],
      latency: 0,
      bodyType: 'INLINE',
      body: '{\n  "message": "OK"\n}',
      filePath: '',
      databucketId: '',
      rules: [],
      rulesOperator: 'AND',
      defaultResponse: false,
    };
    this.applyResponses(routeUuid, [...route.responses, newResponse]);
    this.selectedResponseUuid.set(newResponse.uuid);
  }

  // --- Save / Discard ---

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

  // --- Tab switching in Studio ---

  switchTab(tab: 'routes' | 'data' | 'headers' | 'logs' | 'proxy' | 'settings'): void {
    this.activeTab.set(tab);
  }

  // --- Route & Response document mutations ---

  applyRoutes(nextRoutes: Route[]): void {
    this.envStore.update((draft) => {
      draft.routes = nextRoutes;
    });
    if (this.selectedRouteUuid() && !nextRoutes.some((r) => r.uuid === this.selectedRouteUuid())) {
      this.selectedRouteUuid.set(nextRoutes[0]?.uuid ?? null);
    }
  }

  applyRoute(nextRoute: Route): void {
    this.envStore.update((draft) => {
      const idx = draft.routes.findIndex((r) => r.uuid === nextRoute.uuid);
      if (idx >= 0) draft.routes[idx] = nextRoute;
    });
  }

  applyResponses(routeUuid: string, nextResponses: RouteResponse[]): void {
    this.envStore.update((draft) => {
      const target = draft.routes.find((r) => r.uuid === routeUuid);
      if (target) target.responses = nextResponses;
    });
    if (
      this.selectedResponseUuid() &&
      !nextResponses.some((r) => r.uuid === this.selectedResponseUuid())
    ) {
      this.selectedResponseUuid.set(nextResponses[0]?.uuid ?? null);
    }
  }

  applyResponse(nextResponse: RouteResponse): void {
    this.envStore.update((draft) => {
      for (const r of draft.routes) {
        const idx = r.responses.findIndex((resp) => resp.uuid === nextResponse.uuid);
        if (idx >= 0) {
          r.responses[idx] = nextResponse;
          break;
        }
      }
    });
  }

  applyBuckets(nextBuckets: DataBucket[]): void {
    const prev = this.current()?.data ?? [];
    const newlyAdded = nextBuckets.find(
      (b) => !prev.some((existing) => existing.uuid === b.uuid)
    );
    this.envStore.update((draft) => {
      draft.data = nextBuckets;
    });
    if (newlyAdded) {
      this.selectedBucketUuid.set(newlyAdded.uuid);
    } else if (
      this.selectedBucketUuid() &&
      !nextBuckets.some((b) => b.uuid === this.selectedBucketUuid())
    ) {
      this.selectedBucketUuid.set(nextBuckets[0]?.uuid ?? null);
    }
  }

  applyBucket(nextBucket: DataBucket): void {
    this.envStore.update((draft) => {
      const idx = draft.data.findIndex((b) => b.uuid === nextBucket.uuid);
      if (idx >= 0) draft.data[idx] = nextBucket;
    });
  }

  applySettings(nextEnvironment: Environment): void {
    this.envStore.update((draft) => {
      draft.name = nextEnvironment.name;
      draft.port = nextEnvironment.port;
      draft.endpointPrefix = nextEnvironment.endpointPrefix;
      draft.headers = nextEnvironment.headers;
      draft.proxyMode = nextEnvironment.proxyMode;
      draft.proxyHost = nextEnvironment.proxyHost;
      draft.proxyRemovePrefix = nextEnvironment.proxyRemovePrefix;
      draft.tlsOptions = nextEnvironment.tlsOptions;
    });
  }

  onImported(): void {
    void this.envStore.refreshList();
  }

  // --- Derived lookups ---

  selectedRoute(): Route | null {
    const cur = this.current();
    if (!cur || !this.selectedRouteUuid()) return null;
    return cur.routes.find((r) => r.uuid === this.selectedRouteUuid()) ?? null;
  }

  selectedResponse(): RouteResponse | null {
    const activeRoute = this.selectedRoute();
    if (!activeRoute || !this.selectedResponseUuid()) return null;
    return activeRoute.responses.find((r) => r.uuid === this.selectedResponseUuid()) ?? null;
  }

  selectedBucket(): DataBucket | null {
    const cur = this.current();
    if (!cur || !this.selectedBucketUuid()) return null;
    return cur.data.find((b) => b.uuid === this.selectedBucketUuid()) ?? null;
  }

  bucketReferences(): string[] {
    const cur = this.current();
    if (!cur) return [];
    return cur.routes.flatMap((r) =>
      r.responses.map((resp) => resp.databucketId)
    ).filter((ref) => ref !== '');
  }

  onRouteSelected(routeUuid: string): void {
    this.selectedRouteUuid.set(routeUuid);
    const target = this.current()?.routes.find((r) => r.uuid === routeUuid);
    this.selectedResponseUuid.set(target?.responses[0]?.uuid ?? null);
  }

  onRouteListChanged(nextRoutes: Route[]): void {
    const prev = this.current()?.routes ?? [];
    const newlyAdded = nextRoutes.find(
      (r) => !prev.some((existing) => existing.uuid === r.uuid)
    );
    this.applyRoutes(nextRoutes);
    if (newlyAdded) this.onRouteSelected(newlyAdded.uuid);
  }

  onResponseSelected(responseUuid: string): void {
    this.selectedResponseUuid.set(responseUuid);
  }

  canClearLogs(): boolean {
    return this.authStore.hasRole('admin');
  }

  logout(): void {
    this.authStore.logout();
  }

  private syncFirstRoute(): void {
    const cur = this.current();
    if (cur && cur.routes.length > 0 && !this.selectedRouteUuid()) {
      this.selectedRouteUuid.set(cur.routes[0].uuid);
      this.selectedResponseUuid.set(cur.routes[0].responses[0]?.uuid ?? null);
    }
  }

  private resetSelection(): void {
    this.selectedRouteUuid.set(null);
    this.selectedResponseUuid.set(null);
    this.selectedBucketUuid.set(null);
    this.activeTab.set('routes');
  }
}
