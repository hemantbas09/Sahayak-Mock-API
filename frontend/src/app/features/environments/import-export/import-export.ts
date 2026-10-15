import { Component, inject, input, output, signal } from '@angular/core';
import { MockApiClient } from '../../../core/mock-api.client';
import { downloadJson, readFileAsText } from '../../../core/utils';
import { Modal } from '../../../shared/components/modal/modal';
import { IconComponent } from '../../../shared/components/icon/icon.component';

/**
 * Import/export modal. Block: .import-export
 */
@Component({
  selector: 'app-import-export',
  imports: [Modal, IconComponent],
  template: `
    <app-modal title="Import / Export" (closed)="closed.emit()">
      <div class="import-export">
        <!-- Import -->
        <section class="import-export__section">
          <p class="import-export__section-label">Import file (Mockoon JSON or OpenAPI v3)</p>

          @if (selectedFile(); as pickedFile) {
            <div class="import-export__file-info">
              <span class="import-export__file-name">{{ pickedFile.name }}</span>
              <span class="import-export__file-size">{{ formatFileSize(pickedFile.size) }}</span>
              <button type="button" class="import-export__file-remove" (click)="resetImport()">Remove</button>
            </div>

            @if (previewEnvironments().length > 0) {
              <div class="import-export__preview">
                @for (previewEnv of previewEnvironments(); track $index) {
                  <p class="import-export__preview-row">
                    <strong>{{ previewEnv.name || '(unnamed)' }}</strong>
                    · port {{ previewEnv.port }}
                    · {{ previewEnv.routeCount }} routes
                    · {{ previewEnv.bucketCount }} buckets
                  </p>
                }
              </div>
            } @else {
              <p class="import-export__hint">
                File content will be parsed server-side.
              </p>
            }

            <button
              class="import-export__btn import-export__btn--primary"
              type="button"
              [disabled]="importing()"
              (click)="runImport(pickedFile)"
            >
              {{ importing() ? 'Importing…' : 'Import' }}
            </button>

            @if (importError(); as importErrorMessage) {
              <p class="import-export__error">{{ importErrorMessage }}</p>
            }
            @if (importResult(); as importedEnvs) {
              <div class="import-export__result">
                @for (importedEnv of importedEnvs; track importedEnv.uuid) {
                  <p class="import-export__result-row">
                    <app-icon name="check" [size]="12" />
                    <span>{{ importedEnv.name }}</span>
                    @if (importedEnv.portConflict) {
                      <span class="import-export__conflict-note">(Port conflict — listener stays paused)</span>
                    }
                  </p>
                }
              </div>
            }
          } @else {
            <label class="import-export__filepick">
              <input type="file" accept=".json,application/json" (change)="onFileChosen($event)" />
              <span>Choose file…</span>
            </label>
          }
        </section>

        <!-- Export -->
        <section class="import-export__section">
          <p class="import-export__section-label">Export environment</p>
          <div class="import-export__row">
            <button
              class="import-export__btn"
              type="button"
              [disabled]="exporting()"
              (click)="runExport()"
            >
              {{ exporting() ? 'Preparing…' : 'Download JSON' }}
            </button>
            <span class="import-export__hint">
              Export format is compatible with standard Mockoon environments.
            </span>
          </div>
          @if (exportError(); as exportErrorMessage) {
            <p class="import-export__error">{{ exportErrorMessage }}</p>
          }
        </section>
      </div>
    </app-modal>
  `,
  styleUrl: './import-export.scss',
})
export class ImportExport {
  private readonly apiClient = inject(MockApiClient);

  readonly environmentUuidInput = input<string>('');
  readonly environmentNameInput = input('environment');
  readonly closed = output<void>();
  readonly imported = output<void>();

  readonly selectedFile = signal<File | null>(null);
  readonly previewEnvironments = signal<MockoonPreviewEnv[]>([]);
  readonly importing = signal(false);
  readonly importResult = signal<ImportedEnvRow[] | null>(null);
  readonly importError = signal<string | null>(null);
  readonly exporting = signal(false);
  readonly exportError = signal<string | null>(null);

  onFileChosen(changeEvent: Event): void {
    const fileInput = changeEvent.target as HTMLInputElement;
    const pickedFile = fileInput.files?.[0];
    if (!pickedFile) return;
    this.selectedFile.set(pickedFile);
    this.importResult.set(null);
    this.importError.set(null);
    this.previewEnvironments.set([]);
    void this.buildPreview(pickedFile);
  }

  resetImport(): void {
    this.selectedFile.set(null);
    this.previewEnvironments.set([]);
    this.importResult.set(null);
    this.importError.set(null);
  }

  async runImport(uploadFile: File): Promise<void> {
    if (this.importing()) return;
    this.importing.set(true);
    this.importError.set(null);
    this.importResult.set(null);
    try {
      const importResponse = await this.apiClient.importFile(uploadFile);
      this.importResult.set(importResponse.imported);
      this.imported.emit();
    } catch (caught) {
      this.importError.set(caught instanceof Error ? caught.message : 'Import failed');
    } finally {
      this.importing.set(false);
    }
  }

  async runExport(): Promise<void> {
    if (this.exporting() || this.environmentUuidInput() === '') return;
    this.exporting.set(true);
    this.exportError.set(null);
    try {
      const exportBlob = await this.apiClient.exportEnvironment(this.environmentUuidInput());
      const exportText = await exportBlob.text();
      const safeFileName = slugify(this.environmentNameInput()) + '.mockoon.json';
      downloadJson(safeFileName, exportText);
    } catch (caught) {
      this.exportError.set(caught instanceof Error ? caught.message : 'Export failed');
    } finally {
      this.exporting.set(false);
    }
  }

  formatFileSize(byteCount: number): string {
    if (byteCount < 1024) return `${byteCount} B`;
    if (byteCount < 1024 * 1024) return `${(byteCount / 1024).toFixed(1)} KB`;
    return `${(byteCount / (1024 * 1024)).toFixed(1)} MB`;
  }

  private async buildPreview(uploadFile: File): Promise<void> {
    try {
      const fileText = await readFileAsText(uploadFile);
      const parsedFile: unknown = JSON.parse(fileText);
      if (parsedFile && typeof parsedFile === 'object' && 'data' in (parsedFile as Record<string, unknown>)) {
        const dataField = (parsedFile as Record<string, unknown>)['data'];
        if (Array.isArray(dataField)) {
          this.previewEnvironments.set(
            dataField.map((entry): MockoonPreviewEnv => {
              const envRecord = (entry ?? {}) as Record<string, unknown>;
              const routes = Array.isArray(envRecord['routes']) ? (envRecord['routes'] as unknown[]) : [];
              const buckets = Array.isArray(envRecord['data']) ? (envRecord['data'] as unknown[]) : [];
              return {
                name: typeof envRecord['name'] === 'string' ? envRecord['name'] : '',
                port: typeof envRecord['port'] === 'number' ? envRecord['port'] : 0,
                routeCount: routes.length,
                bucketCount: buckets.length,
              };
            }),
          );
        }
      }
    } catch {
      // Not parseable client-side
    }
  }
}

interface MockoonPreviewEnv {
  name: string;
  port: number;
  routeCount: number;
  bucketCount: number;
}

interface ImportedEnvRow {
  uuid: string;
  name: string;
  portConflict: boolean;
}

function slugify(rawName: string): string {
  return (
    rawName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'environment'
  );
}
