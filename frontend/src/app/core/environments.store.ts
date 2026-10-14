/**
 * EnvironmentsStore — editor state (DESIGN §7.1, F6).
 *
 * Signals: list, current, selectedUuid, savedVersion, dirty, saving,
 * saveError, conflictInfo. Mutations flow through `update()` which clones
 * the document, applies the change and marks the store dirty — signals
 * stay reactive and the saved snapshot stays intact for "Discard".
 *
 * Save = PUT {version: savedVersion, environment} (whole document,
 * optimistic concurrency). 409 → conflictInfo so the banner offers
 * "reload latest" / "discard mine".
 */
import { Injectable, inject, signal } from '@angular/core';
import { createEnvironment } from './defaults';
import { MockApiClient, ApiError } from './mock-api.client';
import { AuthStore } from './auth.store';
import { ConflictInfo, Environment, EnvironmentSummary } from './types';

@Injectable({ providedIn: 'root' })
export class EnvironmentsStore {
  private readonly apiClient = inject(MockApiClient);
  private readonly authStore = inject(AuthStore);

  readonly list = signal<EnvironmentSummary[]>([]);
  readonly selectedUuid = signal<string | null>(null);
  readonly current = signal<Environment | null>(null);
  /** Version last acknowledged by the server — echoed on the next PUT. */
  readonly savedVersion = signal<number>(0);
  readonly dirty = signal<boolean>(false);
  readonly saving = signal<boolean>(false);
  readonly saveError = signal<string | null>(null);
  /** Set on a 409; cleared on successful save or explicit dismiss. */
  readonly conflictInfo = signal<ConflictInfo | null>(null);
  /** Track in-flight start/stop listener requests by environment uuid. */
  readonly listenerBusy = signal<Record<string, boolean>>({});

  /** Last server-confirmed snapshot; "Discard" restores this. */
  private savedSnapshot: Environment | null = null;

  // ---------------------------------------------------------------- list

  async refreshList(): Promise<void> {
    try {
      this.list.set(await this.apiClient.listEnvironments());
      this.saveError.set(null);
    } catch (caught) {
      const msg = this.messageFrom(caught);
      if (this.isAuthError(caught, msg)) {
        const ok = await this.authStore.autoAuthenticateSeed();
        if (ok) {
          try {
            this.list.set(await this.apiClient.listEnvironments());
            this.saveError.set(null);
            return;
          } catch {
            // ignore retry failure
          }
        }
        return;
      }
      if (msg) this.saveError.set(msg);
    }
  }

  /** Load the full document for a summary row. */
  async selectEnvironment(environmentUuid: string): Promise<void> {
    this.conflictInfo.set(null);
    this.saveError.set(null);
    try {
      const fullEnvironment = await this.apiClient.getEnvironment(environmentUuid);
      this.current.set(fullEnvironment);
      this.savedVersion.set(fullEnvironment.version);
      this.savedSnapshot = structuredClone(fullEnvironment);
      this.selectedUuid.set(environmentUuid);
      this.dirty.set(false);
    } catch (caught) {
      const msg = this.messageFrom(caught);
      if (this.isAuthError(caught, msg)) {
        const ok = await this.authStore.autoAuthenticateSeed();
        if (ok) {
          try {
            const fullEnvironment = await this.apiClient.getEnvironment(environmentUuid);
            this.current.set(fullEnvironment);
            this.savedVersion.set(fullEnvironment.version);
            this.savedSnapshot = structuredClone(fullEnvironment);
            this.selectedUuid.set(environmentUuid);
            this.dirty.set(false);
            return;
          } catch {
            // ignore retry failure
          }
        }
        return;
      }
      if (msg) this.saveError.set(msg);
    }
  }

  /** Create (server assigns uuid/version) and select the new environment. */
  async createEnvironment(name = 'New environment', endpointPrefix = '', port = 3000): Promise<void> {
    const draft = createEnvironment(name, port, endpointPrefix);
    try {
      const created = await this.apiClient.createEnvironment(draft);
      await this.refreshList();
      await this.selectEnvironment(created.uuid);
    } catch (caught) {
      const msg = this.messageFrom(caught);
      if (msg) this.saveError.set(msg);
    }
  }

  async deleteEnvironment(environmentUuid: string): Promise<void> {
    try {
      await this.apiClient.deleteEnvironment(environmentUuid);
      if (this.selectedUuid() === environmentUuid) {
        this.selectedUuid.set(null);
        this.current.set(null);
        this.savedSnapshot = null;
        this.savedVersion.set(0);
        this.dirty.set(false);
      }
      await this.refreshList();
    } catch (caught) {
      const msg = this.messageFrom(caught);
      if (msg) this.saveError.set(msg);
    }
  }

  async duplicateEnvironment(environmentUuid: string): Promise<void> {
    try {
      await this.apiClient.duplicateEnvironment(environmentUuid);
      await this.refreshList();
    } catch (caught) {
      const msg = this.messageFrom(caught);
      if (msg) this.saveError.set(msg);
    }
  }

  // ------------------------------------------------ listener controls

  async startEnvironment(environmentUuid: string): Promise<boolean> {
    this.listenerBusy.update((m) => ({ ...m, [environmentUuid]: true }));
    try {
      await this.apiClient.startEnvironment(environmentUuid);
      this.saveError.set(null);
      await this.refreshList();
      return true;
    } catch (caught) {
      const msg = this.messageFrom(caught);
      if (msg) this.saveError.set(msg);
      await this.refreshList();
      return false;
    } finally {
      this.listenerBusy.update((m) => ({ ...m, [environmentUuid]: false }));
    }
  }

  async stopEnvironment(environmentUuid: string): Promise<boolean> {
    this.listenerBusy.update((m) => ({ ...m, [environmentUuid]: true }));
    try {
      await this.apiClient.stopEnvironment(environmentUuid);
      this.saveError.set(null);
      await this.refreshList();
      return true;
    } catch (caught) {
      const msg = this.messageFrom(caught);
      if (msg) this.saveError.set(msg);
      await this.refreshList();
      return false;
    } finally {
      this.listenerBusy.update((m) => ({ ...m, [environmentUuid]: false }));
    }
  }

  async toggleEnvironmentListener(environmentUuid: string): Promise<void> {
    const summary = this.list().find((e) => e.uuid === environmentUuid);
    if (!summary) return;
    if (summary.listener === 'listening') {
      await this.stopEnvironment(environmentUuid);
    } else {
      await this.startEnvironment(environmentUuid);
    }
  }

  // ----------------------------------------------------------- mutations

  /**
   * The single mutation entry point for the editor: clones `current`,
   * applies `mutator` to the clone, publishes the new reference and marks
   * the store dirty.
   */
  update(mutator: (draftEnvironment: Environment) => void): void {
    const draft = this.current();
    if (!draft) return;
    const clonedEnvironment = structuredClone(draft);
    mutator(clonedEnvironment);
    this.current.set(clonedEnvironment);
    this.dirty.set(true);
    this.saveError.set(null);
  }

  // ---------------------------------------------------------------- save

  /** Whole-document save with the saved version (409 → conflictInfo). */
  async saveCurrent(): Promise<boolean> {
    const draft = this.current();
    if (!draft || this.saving()) return false;
    this.saving.set(true);
    this.saveError.set(null);
    try {
      const saved = await this.apiClient.saveEnvironment(draft.uuid, this.savedVersion(), draft);
      this.savedVersion.set(saved.version);
      const savedEnvironment = structuredClone(draft);
      savedEnvironment.version = saved.version;
      this.savedSnapshot = savedEnvironment;
      this.current.set(savedEnvironment);
      this.dirty.set(false);
      this.conflictInfo.set(null);
      await this.refreshList();
      return true;
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 409 && caught.conflict) {
        this.conflictInfo.set(caught.conflict);
      } else {
        const msg = this.messageFrom(caught);
        if (msg) this.saveError.set(msg);
      }
      return false;
    } finally {
      this.saving.set(false);
    }
  }

  /** Discard unedited changes: restore the server-confirmed snapshot. */
  async discardChanges(): Promise<void> {
    if (!this.savedSnapshot) {
      this.current.set(null);
      this.selectedUuid.set(null);
      return;
    }
    this.current.set(structuredClone(this.savedSnapshot));
    this.savedVersion.set(this.savedSnapshot.version);
    this.dirty.set(false);
    this.saveError.set(null);
    this.conflictInfo.set(null);
  }

  /** Conflict banner action: reload the latest server version. */
  async reloadLatest(): Promise<void> {
    const draft = this.current();
    if (!draft) return;
    await this.selectEnvironment(draft.uuid);
  }

  dismissConflict(): void {
    this.conflictInfo.set(null);
  }

  // -------------------------------------------------------------- helpers

  private isAuthError(caught: unknown, msg: string): boolean {
    return (
      (caught instanceof ApiError && caught.status === 401) ||
      msg.toLowerCase().includes('auth')
    );
  }

  private messageFrom(caught: unknown): string {
    const raw = caught instanceof Error ? caught.message : 'Something went wrong';
    const lower = raw.toLowerCase();
    if (
      lower.includes('auth') ||
      lower.includes('token') ||
      lower.includes('credential') ||
      lower.includes('unauthorized') ||
      lower.includes('forbidden')
    ) {
      return '';
    }
    return raw;
  }
}
