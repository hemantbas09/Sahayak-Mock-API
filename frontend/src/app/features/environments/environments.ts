import { ChangeDetectorRef, Component, HostListener, OnInit, computed, inject, signal } from '@angular/core';
import { AuthStore } from '../../core/auth.store';
import { EnvironmentsStore } from '../../core/environments.store';
import { MockApiClient } from '../../core/mock-api.client';
import { downloadJson } from '../../core/utils';
import {
  Environment,
  EnvironmentSummary,
  Route,
  RouteResponse,
} from '../../core/types';
import { RouteList } from './route-list/route-list';
import { ResponseEditor } from './response-editor/response-editor';
import { LogViewer } from './log-viewer/log-viewer';
import { EnvSettings } from './env-settings/env-settings';
import { KvList } from '../../shared/components/kv-list/kv-list';
import { IconComponent } from '../../shared/components/icon/icon.component';
import { Modal } from '../../shared/components/modal/modal';

import { SelectValueSync } from '../../shared/directives/select-value-sync.directive';

/**
 * Environments page: Supports both the "Projects Dashboard" (Screenshot 1)
 * and the "Project Studio / Editor" (Screenshot 2).
 */
@Component({
  selector: 'app-environments',
  imports: [
    RouteList,
    ResponseEditor,
    LogViewer,
    EnvSettings,
    KvList,
    IconComponent,
    Modal,
    SelectValueSync,
  ],
  templateUrl: './environments.html',
  styleUrl: './environments.scss',
})
export class Environments implements OnInit {
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly envStore = inject(EnvironmentsStore);
  private readonly authStore = inject(AuthStore);
  private readonly apiClient = inject(MockApiClient);

  // --- View mode: Dashboard (Screenshot 1) vs Studio (Screenshot 2) ---
  readonly viewMode = signal<'dashboard' | 'studio'>('dashboard');
  readonly dashboardTab = signal<'all' | 'active' | 'paused'>('all');
  readonly searchQuery = signal('');
  readonly copiedUuid = signal<string | null>(null);

  // --- UI state inside Studio ---
  readonly activeTab = signal<'routes' | 'headers' | 'logs' | 'proxy' | 'settings'>('routes');
  readonly selectedRouteUuid = signal<string | null>(null);
  readonly selectedResponseUuid = signal<string | null>(null);
  readonly showSettings = signal(false);
  readonly isImporting = signal(false);

  // --- Create Environment modal state ---
  readonly showCreateModal = signal(false);
  readonly newEnvName = signal('');
  readonly newEnvPrefix = signal('');
  readonly newEnvPort = signal(3000);
  readonly prefixManuallyEdited = signal(false);

  // --- Card dropdown & Project deletion state ---
  readonly activeCardMenuUuid = signal<string | null>(null);
  readonly projectToDelete = signal<{ uuid: string; name: string; port: number; routeCount: number } | null>(null);
  readonly isDeletingProject = signal<boolean>(false);

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
          this.cdr.markForCheck();
        });
      }
      this.cdr.markForCheck();
    });
  }

  // --- Dashboard actions ---

  openInStudio(summary: EnvironmentSummary): void {
    this.resetSelection();
    void this.envStore.selectEnvironment(summary.uuid).then(() => {
      this.syncFirstRoute();
      this.viewMode.set('studio');
      this.cdr.markForCheck();
    });
  }

  backToDashboard(): void {
    this.viewMode.set('dashboard');
  }

  getBaseUrl(): string {
    if (typeof window !== 'undefined' && window.location) {
      const port = window.location.port;
      if (port === '4200') {
        return `${window.location.protocol}//${window.location.hostname}:4000`;
      }
      return window.location.origin;
    }
    return 'http://localhost:4000';
  }

  getEnvironmentPrefix(summaryOrEnv?: { name?: string; endpointPrefix?: string } | null): string {
    if (!summaryOrEnv) return '';
    if (summaryOrEnv.endpointPrefix && summaryOrEnv.endpointPrefix.trim()) {
      const p = summaryOrEnv.endpointPrefix.trim();
      return p.startsWith('/') ? p : `/${p}`;
    }
    if (summaryOrEnv.name) {
      const slug = summaryOrEnv.name.toLowerCase().replace(/[^a-z0-9_-]/g, '');
      return slug ? `/${slug}` : '';
    }
    return '';
  }

  getEnvironmentUrl(summaryOrEnv: { name?: string; port?: number; endpointPrefix?: string }): string {
    const prefix = this.getEnvironmentPrefix(summaryOrEnv);
    return `${this.getBaseUrl()}${prefix}`;
  }

  getRouteFullUrl(route: Route): string {
    const currentEnv = this.current();
    if (!currentEnv) return route.endpoint;
    const prefix = this.getEnvironmentPrefix(currentEnv);
    const ep = route.endpoint === '' ? '/' : (route.endpoint.startsWith('/') ? route.endpoint : `/${route.endpoint}`);
    return `${this.getBaseUrl()}${prefix}${ep}`;
  }

  copyUrl(summaryOrEnv: EnvironmentSummary | Environment, event?: MouseEvent): void {
    event?.stopPropagation();
    const url = this.getEnvironmentUrl(summaryOrEnv);
    navigator.clipboard.writeText(url).then(() => {
      this.copiedUuid.set(summaryOrEnv.uuid);
      setTimeout(() => this.copiedUuid.set(null), 2000);
    });
  }

  copyRouteUrl(summaryOrEnv: EnvironmentSummary | Environment, route: Route, event?: MouseEvent): void {
    event?.stopPropagation();
    const fullUrl = this.getRouteFullUrl(route);
    navigator.clipboard.writeText(fullUrl).then(() => {
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

  // --- Create Environment modal actions ---

  openCreateEnvironmentModal(): void {
    const existingPorts = this.list().map((e) => e.port);
    const nextPort = existingPorts.length > 0 ? Math.max(...existingPorts) + 1 : 3000;
    this.newEnvName.set('');
    this.newEnvPrefix.set('');
    this.newEnvPort.set(nextPort);
    this.prefixManuallyEdited.set(false);
    this.showCreateModal.set(true);
  }

  closeCreateEnvironmentModal(): void {
    this.showCreateModal.set(false);
  }

  onNewEnvNameChange(event: Event): void {
    const name = (event.target as HTMLInputElement).value;
    this.newEnvName.set(name);
    if (!this.prefixManuallyEdited()) {
      const slug = name.toLowerCase().replace(/[^a-z0-9_-]/g, '');
      this.newEnvPrefix.set(slug ? `/${slug}` : '');
    }
  }

  onNewEnvPrefixChange(event: Event): void {
    this.prefixManuallyEdited.set(true);
    const prefix = (event.target as HTMLInputElement).value;
    this.newEnvPrefix.set(prefix);
  }

  onNewEnvPortChange(event: Event): void {
    const port = Number((event.target as HTMLInputElement).value) || 3000;
    this.newEnvPort.set(port);
  }

  async confirmCreateEnvironment(): Promise<void> {
    const name = this.newEnvName().trim();
    if (!name) return;

    const slug = name.toLowerCase().replace(/[^a-z0-9_-]/g, '') || name.toLowerCase();
    let prefix = this.newEnvPrefix().trim();
    if (!prefix) {
      prefix = `/${slug}`;
    } else if (!prefix.startsWith('/')) {
      prefix = `/${prefix}`;
    }
    const port = this.newEnvPort() || 3000;

    await this.envStore.createEnvironment(name, prefix, port);
    this.showCreateModal.set(false);
    const created = this.current();
    if (created) {
      this.resetSelection();
      this.syncFirstRoute();
      this.viewMode.set('studio');
    }
  }

  // --- Listener controls (Active vs Paused toggle) ---

  isListenerBusy(uuid?: string): boolean {
    if (!uuid) return false;
    return !!this.envStore.listenerBusy()[uuid];
  }

  isCurrentActive(): boolean {
    const cur = this.current();
    if (!cur) return false;
    const summary = this.list().find((e) => e.uuid === cur.uuid);
    return summary?.listener === 'listening';
  }

  async toggleListener(summary: EnvironmentSummary, event?: MouseEvent): Promise<void> {
    event?.stopPropagation();
    await this.envStore.toggleEnvironmentListener(summary.uuid);
    this.cdr.markForCheck();
  }

  async toggleCurrentListener(): Promise<void> {
    const cur = this.current();
    if (!cur) return;
    await this.envStore.toggleEnvironmentListener(cur.uuid);
    this.cdr.markForCheck();
  }

  // --- Environment actions ---

  selectEnvironmentRow(summary: EnvironmentSummary): void {
    this.resetSelection();
    void this.envStore.selectEnvironment(summary.uuid).then(() => {
      this.syncFirstRoute();
      this.cdr.markForCheck();
    });
  }

  onBreadcrumbEnvChange(event: Event): void {
    const uuid = (event.target as HTMLSelectElement).value;
    const summary = this.list().find((e) => e.uuid === uuid);
    if (summary) {
      this.selectEnvironmentRow(summary);
    }
  }

  createEnvironmentRow(): void {
    this.openCreateEnvironmentModal();
  }

  @HostListener('document:click')
  onDocumentClick(): void {
    if (this.activeCardMenuUuid()) {
      this.closeCardMenu();
    }
  }

  toggleCardMenu(uuid: string, event?: MouseEvent): void {
    event?.stopPropagation();
    this.activeCardMenuUuid.update((cur) => (cur === uuid ? null : uuid));
  }

  closeCardMenu(): void {
    this.activeCardMenuUuid.set(null);
  }

  promptDeleteProject(
    target: { uuid: string; name: string; port: number; routeCount?: number; routes?: unknown[] },
    event?: MouseEvent
  ): void {
    event?.stopPropagation();
    this.closeCardMenu();
    const count = typeof target.routeCount === 'number' ? target.routeCount : (target.routes?.length ?? 0);
    this.projectToDelete.set({
      uuid: target.uuid,
      name: target.name,
      port: target.port,
      routeCount: count,
    });
  }

  promptDeleteCurrentProject(): void {
    const cur = this.current();
    if (!cur) return;
    this.promptDeleteProject(cur);
  }

  cancelDeleteProject(): void {
    if (this.isDeletingProject()) return;
    this.projectToDelete.set(null);
  }

  async confirmDeleteProject(): Promise<void> {
    const target = this.projectToDelete();
    if (!target) return;
    this.isDeletingProject.set(true);
    try {
      await this.envStore.deleteEnvironment(target.uuid);
      if (this.viewMode() === 'studio' && this.current()?.uuid === target.uuid) {
        this.viewMode.set('dashboard');
      }
      this.projectToDelete.set(null);
      this.cdr.markForCheck();
    } finally {
      this.isDeletingProject.set(false);
    }
  }

  deleteEnvironmentRow(summary: EnvironmentSummary, event?: MouseEvent): void {
    this.promptDeleteProject(summary, event);
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

  switchTab(tab: 'routes' | 'headers' | 'logs' | 'proxy' | 'settings'): void {
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
    this.activeTab.set('routes');
  }
}
