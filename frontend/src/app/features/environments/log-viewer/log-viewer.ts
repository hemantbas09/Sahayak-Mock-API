import { Component, OnDestroy, OnInit, inject, input, signal } from '@angular/core';
import { MockApiClient } from '../../../core/mock-api.client';
import { EnvironmentSummary, RequestLog } from '../../../core/types';
import { formatLogTime as formatLogTimeImport } from '../../../core/utils';
import { ElapsedTimePipe } from '../../../shared/pipes/elapsed-time.pipe';

/**
 * F13 — live request log viewer. Block: .log-viewer
 *
 * Polls GET /api/logs every 5 s (pausable), filters by environment, and
 * shows method/path/status/latency rows with expandable detail (request +
 * response headers, bodies). The clear action is admin-only (DELETE /api/logs).
 */
@Component({
  selector: 'app-log-viewer',
  imports: [ElapsedTimePipe],
  template: `
    <div class="log-viewer">
      <header class="log-viewer__head">
        <h4 class="log-viewer__heading">Request log</h4>
        <span class="log-viewer__controls">
          <select
            class="log-viewer__filter"
            [value]="filterEnvUuid()"
            (change)="setFilterEnv($event)"
            aria-label="Filter by environment"
          >
            <option value="">all environments</option>
            @for (summary of environmentsInput(); track summary.uuid) {
              <option [value]="summary.uuid">{{ summary.name }} ({{ summary.port }})</option>
            }
          </select>
          <button class="log-viewer__pause" type="button" (click)="togglePause()">
            {{ paused() ? '▶ Resume' : '⏸ Pause' }}
          </button>
          @if (canClearInput()) {
            <button
              class="log-viewer__clear"
              type="button"
              [disabled]="clearing()"
              (click)="clearAllLogs()"
            >🗑 Clear</button>
          }
          <span class="log-viewer__status">
            @if (paused()) {
              paused
            } @else {
              updated {{ formatLogTime(lastUpdated()) }}
            }
          </span>
        </span>
      </header>

      @if (loadError(); as errorMessage) {
        <p class="log-viewer__error">{{ errorMessage }}</p>
      }

      @if (logs().length === 0) {
        <p class="log-viewer__empty">
          No requests yet — hit the mock port and watch the log fill up.
        </p>
      } @else {
        <table class="log-viewer__table">
          <thead>
            <tr>
              <th class="log-viewer__th log-viewer__th--time">Time</th>
              <th class="log-viewer__th log-viewer__th--method">Method</th>
              <th class="log-viewer__th">Path</th>
              <th class="log-viewer__th log-viewer__th--status">Status</th>
              <th class="log-viewer__th log-viewer__th--latency">Latency</th>
            </tr>
          </thead>
          <tbody>
            @for (logEntry of logs(); track logEntryKey(logEntry); let logIndex = $index) {
              <tr
                class="log-viewer__row"
                [class.log-viewer__row--open]="expandedKey() === logEntryKey(logEntry)"
                (click)="toggleExpanded(logEntryKey(logEntry))"
              >
                <td class="log-viewer__td log-viewer__td--time">
                  {{ formatLogTime(logEntry.ts) }}
                  <span class="log-viewer__ago">{{ logEntry.ts | elapsedTime: nowMs() }}</span>
                </td>
                <td class="log-viewer__td">
                  <span
                    class="log-viewer__method"
                    [class.log-viewer__method--get]="logEntry.method === 'GET'"
                    [class.log-viewer__method--post]="logEntry.method === 'POST'"
                    [class.log-viewer__method--put]="logEntry.method === 'PUT'"
                    [class.log-viewer__method--patch]="logEntry.method === 'PATCH'"
                    [class.log-viewer__method--delete]="logEntry.method === 'DELETE'"
                  >
                    {{ logEntry.method }}
                  </span>
                </td>
                <td class="log-viewer__td log-viewer__td--path">{{ logEntry.url }}</td>
                <td class="log-viewer__td">
                  <span
                    class="log-viewer__statuscode"
                    [class.log-viewer__statuscode--error]="logEntry.resStatus >= 400"
                    [class.log-viewer__statuscode--warn]="logEntry.resStatus >= 300 && logEntry.resStatus < 400"
                  >
                    {{ logEntry.resStatus }}
                  </span>
                </td>
                <td class="log-viewer__td log-viewer__td--latency">{{ logEntry.latencyMs }} ms</td>
              </tr>
              @if (expandedKey() === logEntryKey(logEntry)) {
                <tr class="log-viewer__detail-row">
                  <td colspan="5">
                    <div class="log-viewer__detail">
                      <p class="log-viewer__detail-env">
                        env: {{ envNameFor(logEntry.envUuid) }} · from {{ logEntry.ip }}
                      </p>
                      <div class="log-viewer__detail-grid">
                        <div class="log-viewer__detail-block">
                          <p class="log-viewer__detail-label">Request headers</p>
                          <pre class="log-viewer__detail-pre">{{ formatHeaderMap(logEntry.reqHeaders) }}</pre>
                          @if (hasQueryParams(logEntry)) {
                            <p class="log-viewer__detail-label">Query</p>
                            <pre class="log-viewer__detail-pre">{{ formatHeaderMap(logEntry.query) }}</pre>
                          }
                          @if (logEntry.reqBody !== '') {
                            <p class="log-viewer__detail-label">Request body <span class="log-viewer__trunc-note">(truncated to 64 KB)</span></p>
                            <pre class="log-viewer__detail-pre">{{ logEntry.reqBody }}</pre>
                          }
                        </div>
                        <div class="log-viewer__detail-block">
                          <p class="log-viewer__detail-label">Response headers</p>
                          <pre class="log-viewer__detail-pre">{{ formatHeaderMap(logEntry.resHeaders) }}</pre>
                          @if (logEntry.resBody !== '') {
                            <p class="log-viewer__detail-label">Response body <span class="log-viewer__trunc-note">(truncated to 256 KB)</span></p>
                            <pre class="log-viewer__detail-pre">{{ logEntry.resBody }}</pre>
                          }
                        </div>
                      </div>
                    </div>
                  </td>
                </tr>
              }
            }
          </tbody>
        </table>
      }
    </div>
  `,
  styleUrl: './log-viewer.scss',
})
export class LogViewer implements OnInit, OnDestroy {
  private readonly apiClient = inject(MockApiClient);
  private pollTimerId: ReturnType<typeof setInterval> | null = null;

  readonly environmentsInput = input<EnvironmentSummary[]>([]);
  /** Show the (admin-only) clear button. */
  readonly canClearInput = input(false);

  readonly logs = signal<RequestLog[]>([]);
  readonly paused = signal(false);
  /** '' = all environments. */
  readonly filterEnvUuid = signal('');
  readonly expandedKey = signal<string | null>(null);
  readonly loadError = signal<string | null>(null);
  readonly clearing = signal(false);
  readonly lastUpdated = signal(Date.now());
  /** Bumped on every tick so the elapsed labels stay fresh while paused. */
  readonly nowMs = signal(Date.now());

  private static readonly POLL_INTERVAL_MS = 5000;
  private static readonly MAX_LOGS = 200;

  ngOnInit(): void {
    void this.poll();
    this.pollTimerId = setInterval(() => {
      this.nowMs.set(Date.now());
      if (!this.paused()) void this.poll();
    }, LogViewer.POLL_INTERVAL_MS);
  }

  ngOnDestroy(): void {
    if (this.pollTimerId !== null) clearInterval(this.pollTimerId);
  }

  togglePause(): void {
    this.paused.update((isPaused) => !isPaused);
  }

  setFilterEnv(changeEvent: Event): void {
    this.filterEnvUuid.set((changeEvent.target as HTMLSelectElement).value);
    void this.poll();
  }

  async clearAllLogs(): Promise<void> {
    if (this.clearing()) return;
    this.clearing.set(true);
    try {
      await this.apiClient.clearLogs();
      this.logs.set([]);
    } catch (caught) {
      this.loadError.set(caught instanceof Error ? caught.message : 'Could not clear logs');
    } finally {
      this.clearing.set(false);
    }
  }

  toggleExpanded(logKey: string): void {
    this.expandedKey.update((currentKey) => (currentKey === logKey ? null : logKey));
  }

  /** Stable per-row identity (two requests can share a millisecond). */
  logEntryKey(logEntry: RequestLog): string {
    return `${logEntry.ts}:${logEntry.url}:${logEntry.method}`;
  }

  /** Local time string for a log timestamp (templates can't see module imports). */
  formatLogTime(timestampMs: number): string {
    return formatLogTimeImport(timestampMs);
  }

  envNameFor(environmentUuid: string): string {
    const matchingSummary = this.environmentsInput().find((summary) => summary.uuid === environmentUuid);
    return matchingSummary ? `${matchingSummary.name} (:${matchingSummary.port})` : 'unknown env';
  }

  hasQueryParams(logEntry: RequestLog): boolean {
    return Object.keys(logEntry.query).length > 0;
  }

  formatHeaderMap(headerMap: Record<string, string>): string {
    const entries = Object.entries(headerMap);
    if (entries.length === 0) return '(none)';
    return entries.map(([headerName, headerValue]) => `${headerName}: ${headerValue}`).join('\n');
  }

  private async poll(): Promise<void> {
    try {
      const nextLogs = await this.apiClient.readLogs({
        envUuid: this.filterEnvUuid() || undefined,
        limit: LogViewer.MAX_LOGS,
      });
      // Newest first (server may return oldest-first).
      nextLogs.sort((earlierLog, laterLog) => laterLog.ts - earlierLog.ts);
      this.logs.set(nextLogs);
      this.lastUpdated.set(Date.now());
      this.loadError.set(null);
    } catch (caught) {
      this.loadError.set(caught instanceof Error ? caught.message : 'Could not load logs');
    }
  }
}
