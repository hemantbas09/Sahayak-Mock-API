import {
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { DataBucket, RouteResponse, RouteRule, RulesOperator } from '../../../core/types';
import { MockApiClient } from '../../../core/mock-api.client';
import { KvList } from '../../../shared/components/kv-list/kv-list';
import { RuleEditor } from '../../../shared/components/rule-editor/rule-editor';
import { HelperPicker } from '../../../shared/components/helper-picker/helper-picker';
import { IconComponent } from '../../../shared/components/icon/icon.component';

/**
 * Modern developer-tool styled response editor.
 */
@Component({
  selector: 'app-response-editor',
  imports: [KvList, RuleEditor, HelperPicker, IconComponent],
  template: `
    @if (responseInput(); as activeResponse) {
      <div class="response-studio">
        <!-- Response Sub-tabs -->
        <nav class="response-studio__subtabs">
          <button
            type="button"
            class="response-studio__subtab"
            [class.response-studio__subtab--active]="activeSubTab() === 'status-body'"
            (click)="activeSubTab.set('status-body')"
          >
            Status & Body
          </button>
          <button
            type="button"
            class="response-studio__subtab"
            [class.response-studio__subtab--active]="activeSubTab() === 'headers'"
            (click)="activeSubTab.set('headers')"
          >
            Headers ({{ activeResponse.headers.length }})
          </button>
          <button
            type="button"
            class="response-studio__subtab"
            [class.response-studio__subtab--active]="activeSubTab() === 'rules'"
            (click)="activeSubTab.set('rules')"
          >
            Rules ({{ activeResponse.rules.length }})
          </button>
          <button
            type="button"
            class="response-studio__subtab"
            [class.response-studio__subtab--active]="activeSubTab() === 'settings'"
            (click)="activeSubTab.set('settings')"
          >
            Settings
          </button>
        </nav>

        @if (activeSubTab() === 'status-body') {
          <!-- Status Code & Latency Bar -->
          <div class="response-studio__status-row">
            <div class="response-studio__status-select-wrap">
              <select
                class="response-studio__status-select"
                [value]="activeResponse.statusCode"
                (change)="setStatusField($event)"
              >
                <option [value]="200">200 - OK</option>
                <option [value]="201">201 - Created</option>
                <option [value]="204">204 - No Content</option>
                <option [value]="400">400 - Bad Request</option>
                <option [value]="401">401 - Unauthorized</option>
                <option [value]="403">403 - Forbidden</option>
                <option [value]="404">404 - Not Found</option>
                <option [value]="409">409 - Conflict</option>
                <option [value]="500">500 - Internal Server Error</option>
              </select>
            </div>

            <div class="response-studio__latency-wrap">
              <app-icon name="clock" [size]="12" />
              <input
                type="number"
                class="response-studio__latency-input"
                min="0"
                max="60000"
                [value]="activeResponse.latency"
                (change)="setLatencyField($event)"
              />
              <span class="response-studio__latency-unit">ms</span>
            </div>

            <div class="response-studio__resp-docs-wrap">
              <input
                type="text"
                class="response-studio__resp-docs"
                placeholder="Documentation (e.g. Success response with user payload)"
                [value]="activeResponse.label"
                (change)="setStringField('label', $event)"
              />
            </div>
          </div>

          <!-- Body Type Selector Tabs -->
          <div class="response-studio__body-toolbar">
            <span class="response-studio__body-title">Response body</span>
            <div class="response-studio__body-types">
              <button
                type="button"
                class="response-studio__body-pill"
                [class.response-studio__body-pill--active]="activeResponse.bodyType === 'INLINE'"
                (click)="setBodyTypeDirect('INLINE')"
              >
                Inline
              </button>
              <button
                type="button"
                class="response-studio__body-pill"
                [class.response-studio__body-pill--active]="activeResponse.bodyType === 'FILE'"
                (click)="setBodyTypeDirect('FILE')"
              >
                File
              </button>
              <button
                type="button"
                class="response-studio__body-pill"
                [class.response-studio__body-pill--active]="activeResponse.bodyType === 'DATABUCKET'"
                (click)="setBodyTypeDirect('DATABUCKET')"
              >
                Data bucket
              </button>
              <button
                type="button"
                class="response-studio__body-pill"
                [class.response-studio__body-pill--active]="activeResponse.bodyType === 'NONE'"
                (click)="setBodyTypeDirect('NONE')"
              >
                None
              </button>
            </div>
          </div>

          <!-- Body Content Area -->
          @switch (activeResponse.bodyType) {
            @case ('INLINE') {
              <div class="response-studio__editor-container">
                <div class="response-studio__editor-header">
                  <app-helper-picker (insertSnippet)="insertSnippetIntoBody($event)" />
                  <div class="response-studio__editor-header-actions">
                    <button
                      type="button"
                      class="response-studio__preview-btn"
                      [disabled]="previewing()"
                      (click)="previewBody()"
                    >
                      @if (previewing()) {
                        Rendering…
                      } @else {
                        <app-icon name="play" [size]="12" />
                        <span>Preview</span>
                      }
                    </button>
                  </div>
                </div>

                <div class="response-studio__code-wrap">
                  <div class="response-studio__line-numbers">
                    @for (line of lineNumbers(); track line) {
                      <span>{{ line }}</span>
                    }
                  </div>
                  <textarea
                    #bodyTextarea
                    class="response-studio__textarea"
                    rows="14"
                    spellcheck="false"
                    placeholder="Enter JSON response or template..."
                    [value]="bodySeedValue()"
                    (input)="onBodyInput()"
                  ></textarea>
                </div>

                <div class="response-studio__editor-footer">
                  <button type="button" class="response-studio__beautify-btn" (click)="beautifyJson()">
                    Format JSON
                  </button>
                  <span class="response-studio__content-type">application/json</span>
                </div>

                @if (previewOutput(); as previewResult) {
                  <div class="response-studio__preview-box">
                    <div class="response-studio__preview-header">
                      <span>Rendered output</span>
                      <button type="button" (click)="previewOutput.set(null)">
                        <app-icon name="close" [size]="12" />
                      </button>
                    </div>
                    <pre class="response-studio__preview-output">{{ previewResult }}</pre>
                  </div>
                }
                @if (previewWarning(); as warning) {
                  <div class="response-studio__alert response-studio__alert--warn">{{ warning }}</div>
                }
                @if (previewError(); as error) {
                  <div class="response-studio__alert response-studio__alert--err">{{ error }}</div>
                }
              </div>
            }

            @case ('FILE') {
              <div class="response-studio__panel-content">
                <label class="response-studio__label">File path (relative to DATA_DIR)</label>
                <input
                  type="text"
                  class="response-studio__input"
                  placeholder="mock-data/users.json"
                  [value]="activeResponse.filePath"
                  (change)="setStringField('filePath', $event)"
                />
                <p class="response-studio__hint">
                  The file will be read from the filesystem and served directly.
                </p>
              </div>
            }

            @case ('DATABUCKET') {
              <div class="response-studio__panel-content">
                <label class="response-studio__label">Select Data Bucket</label>
                <select
                  class="response-studio__select"
                  [value]="activeResponse.databucketId"
                  (change)="setStringField('databucketId', $event)"
                >
                  <option value="" disabled>Select bucket…</option>
                  @for (bucket of bucketsInput(); track bucket.uuid) {
                    <option [value]="bucket.uuid">{{ bucket.name }}</option>
                  }
                </select>
                <p class="response-studio__hint">
                  The data bucket's content will be served directly as the response body.
                </p>
              </div>
            }

            @case ('NONE') {
              <div class="response-studio__panel-content">
                <p class="response-studio__hint">Empty body — only status code and headers will be sent.</p>
              </div>
            }
          }
        }

        @if (activeSubTab() === 'headers') {
          <div class="response-studio__panel-content">
            <app-kv-list
              [itemsInput]="activeResponse.headers"
              keyPlaceholderInput="Header name"
              valuePlaceholderInput="Value"
              (itemsChange)="setHeaders($event)"
            />
          </div>
        }

        @if (activeSubTab() === 'rules') {
          <div class="response-studio__panel-content">
            <app-rule-editor
              [rulesInput]="activeResponse.rules"
              [operatorInput]="activeResponse.rulesOperator"
              [bucketsInput]="bucketsInput()"
              (rulesChange)="setRules($event)"
              (operatorChange)="setRulesOperator($event)"
            />
          </div>
        }

        @if (activeSubTab() === 'settings') {
          <div class="response-studio__panel-content">
            <div class="response-studio__form-group">
              <label class="response-studio__label">Response Label</label>
              <input
                type="text"
                class="response-studio__input"
                [value]="activeResponse.label"
                (change)="setStringField('label', $event)"
              />
            </div>
            <div class="response-studio__form-group">
              <label class="response-studio__checkbox-label">
                <input
                  type="checkbox"
                  [checked]="activeResponse.defaultResponse"
                  (change)="toggleDefaultResponse($event)"
                />
                <span>Default response for this route</span>
              </label>
            </div>
          </div>
        }
      </div>
    }
  `,
  styleUrl: './response-editor.scss',
})
export class ResponseEditor {
  private readonly apiClient = inject(MockApiClient);
  readonly bodyTextarea = viewChild<ElementRef<HTMLTextAreaElement>>('bodyTextarea');

  readonly responseInput = input<RouteResponse | null>(null);
  readonly bucketsInput = input<DataBucket[]>([]);
  readonly responseChange = output<RouteResponse>();
  readonly environmentUuidInput = input<string>('');

  readonly activeSubTab = signal<'status-body' | 'headers' | 'rules' | 'settings'>('status-body');
  readonly previewing = signal(false);
  readonly previewOutput = signal<string | null>(null);
  readonly previewWarning = signal<string | null>(null);
  readonly previewError = signal<string | null>(null);
  readonly bodyContent = signal('');

  private seedKey: string | null = null;
  private bodySeedText = '';
  private previewedSeedKey: string | null = null;

  readonly lineNumbers = computed(() => {
    const text = this.bodyContent();
    const count = (text.match(/\n/g) || []).length + 1;
    return Array.from({ length: Math.max(count, 14) }, (_, i) => i + 1);
  });

  constructor() {
    effect(() => {
      const activeResponse = this.responseInput();
      const nextSeedKey = activeResponse ? `${activeResponse.uuid}:${activeResponse.bodyType}` : null;
      if (this.previewedSeedKey !== nextSeedKey) {
        this.previewedSeedKey = nextSeedKey;
        this.resetPreview();
      }
      if (activeResponse) {
        this.bodyContent.set(activeResponse.body);
      }
    });
  }

  bodySeedValue(): string {
    const activeResponse = this.responseInput();
    if (!activeResponse) return '';
    const currentKey = `${activeResponse.uuid}:${activeResponse.bodyType}`;
    if (this.seedKey !== currentKey) {
      this.seedKey = currentKey;
      this.bodySeedText = activeResponse.body;
      this.bodyContent.set(activeResponse.body);
    }
    return this.bodySeedText;
  }

  onBodyInput(): void {
    const el = this.bodyTextarea()?.nativeElement;
    if (el) {
      this.bodyContent.set(el.value);
    }
    this.commitBodyText();
  }

  commitBodyText(): void {
    const element = this.bodyTextarea()?.nativeElement;
    if (!element) return;
    this.setStringField('body', element.value);
  }

  insertSnippetIntoBody(snippet: string): void {
    const element = this.bodyTextarea()?.nativeElement;
    if (!element) return;
    const start = element.selectionStart;
    const end = element.selectionEnd;
    const currentText = element.value;
    element.value = currentText.slice(0, start) + snippet + currentText.slice(end);
    element.selectionStart = element.selectionEnd = start + snippet.length;
    element.focus();
    this.onBodyInput();
  }

  beautifyJson(): void {
    const element = this.bodyTextarea()?.nativeElement;
    if (!element) return;
    try {
      const parsed = JSON.parse(element.value);
      element.value = JSON.stringify(parsed, null, 2);
      this.onBodyInput();
    } catch {
      // If Handlebars or invalid JSON, ignore
    }
  }

  setBodyTypeDirect(bodyType: 'INLINE' | 'FILE' | 'DATABUCKET' | 'NONE'): void {
    const activeResponse = this.responseInput();
    if (!activeResponse) return;
    this.responseChange.emit({ ...activeResponse, bodyType });
  }

  setStatusField(event: Event): void {
    const activeResponse = this.responseInput();
    if (!activeResponse) return;
    const val = Number((event.target as HTMLSelectElement).value) || 200;
    this.responseChange.emit({ ...activeResponse, statusCode: val });
  }

  setLatencyField(event: Event): void {
    const activeResponse = this.responseInput();
    if (!activeResponse) return;
    const val = Math.max(0, Number((event.target as HTMLInputElement).value) || 0);
    this.responseChange.emit({ ...activeResponse, latency: val });
  }

  setStringField(field: 'label' | 'filePath' | 'databucketId' | 'body', valueOrEvent: Event | string): void {
    const activeResponse = this.responseInput();
    if (!activeResponse) return;
    const rawValue = typeof valueOrEvent === 'string' ? valueOrEvent : (valueOrEvent.target as HTMLInputElement).value;
    this.responseChange.emit({ ...activeResponse, [field]: rawValue });
  }

  setHeaders(headers: { key: string; value: string }[]): void {
    const activeResponse = this.responseInput();
    if (!activeResponse) return;
    this.responseChange.emit({ ...activeResponse, headers });
  }

  setRules(rules: RouteRule[]): void {
    const activeResponse = this.responseInput();
    if (!activeResponse) return;
    this.responseChange.emit({ ...activeResponse, rules });
  }

  setRulesOperator(rulesOperator: RulesOperator): void {
    const activeResponse = this.responseInput();
    if (!activeResponse) return;
    this.responseChange.emit({ ...activeResponse, rulesOperator });
  }

  toggleDefaultResponse(event: Event): void {
    const activeResponse = this.responseInput();
    if (!activeResponse) return;
    const isChecked = (event.target as HTMLInputElement).checked;
    this.responseChange.emit({ ...activeResponse, defaultResponse: isChecked });
  }

  async previewBody(): Promise<void> {
    const environmentUuid = this.environmentUuidInput();
    const element = this.bodyTextarea()?.nativeElement;
    const template = element?.value ?? this.responseInput()?.body ?? '';
    if (!environmentUuid) {
      this.previewError.set('Select an environment to preview templates');
      return;
    }
    this.previewing.set(true);
    this.resetPreview();
    try {
      const result = await this.apiClient.previewTemplate(environmentUuid, template);
      this.previewOutput.set(result.output);
      this.previewWarning.set(result.warnings.length > 0 ? result.warnings.join('; ') : null);
    } catch (caught) {
      this.previewError.set(caught instanceof Error ? caught.message : 'Preview request failed');
    } finally {
      this.previewing.set(false);
    }
  }

  private resetPreview(): void {
    this.previewOutput.set(null);
    this.previewWarning.set(null);
    this.previewError.set(null);
  }
}
