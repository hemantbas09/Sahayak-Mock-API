import {
  ChangeDetectorRef,
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
import { PayloadValidation, RouteResponse, RouteRule, RulesOperator } from '../../../core/types';
import { MockApiClient } from '../../../core/mock-api.client';
import { KvList } from '../../../shared/components/kv-list/kv-list';
import { RuleEditor } from '../../../shared/components/rule-editor/rule-editor';
import { SelectValueSync } from '../../../shared/directives/select-value-sync.directive';
import { Modal } from '../../../shared/components/modal/modal';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import {
  DEFAULT_PAYLOAD_ERROR_BODY,
  SAMPLE_PAYLOAD_SCHEMA,
  inferTypeScriptSchema,
  parseSchema,
  renderValidationErrorBody,
  validatePayload,
  JsonErrorInfo,
  analyzeJsonError,
} from '../../../core/schema-validator';

/**
 * Modern developer-tool styled response editor.
 */
@Component({
  selector: 'app-response-editor',
  imports: [KvList, RuleEditor, SelectValueSync, Modal, IconComponent],
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
          @if (isPostRoute()) {
            <button
              type="button"
              class="response-studio__subtab"
              [class.response-studio__subtab--active]="activeSubTab() === 'payload'"
              (click)="activeSubTab.set('payload')"
            >
              Payload
              @if (activeResponse.payloadValidation?.enabled) {
                <span class="response-studio__subtab-badge">ON</span>
              }
            </button>
          }
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
                [syncSelectValue]="activeResponse.statusCode"
                (change)="setStatusField($event)"
              >
                @for (status of standardStatusCodes; track status.code) {
                  <option [value]="status.code" [selected]="activeResponse.statusCode === status.code">
                    {{ status.text }}
                  </option>
                }
                @if (!isStandardStatus(activeResponse.statusCode)) {
                  <option [value]="activeResponse.statusCode" selected>
                    {{ activeResponse.statusCode }} - Custom
                  </option>
                }
              </select>
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
                <div class="response-studio__code-wrap">
                  <div class="response-studio__line-numbers">
                    @for (line of lineNumbers(); track line) {
                      <span>{{ line }}</span>
                    }
                  </div>
                  <textarea
                    #bodyTextarea
                    class="response-studio__textarea"
                    spellcheck="false"
                    placeholder="Enter JSON response or template..."
                    [value]="bodySeedValue()"
                    (input)="onBodyInput()"
                  ></textarea>
                </div>

                <div class="response-studio__editor-footer">
                  <button type="button" class="response-studio__beautify-btn" (click)="openJsonFormatter('body')">
                    <app-icon name="code" [size]="12" />
                    <span>Format JSON</span>
                  </button>
                  <span class="response-studio__content-type">application/json</span>
                </div>
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

            @case ('NONE') {
              <div class="response-studio__panel-content">
                <p class="response-studio__hint">Empty body — only status code and headers will be sent.</p>
              </div>
            }
          }
        }
        @if (isPostRoute() && activeSubTab() === 'payload') {
          <div class="response-studio__payload-container">
            <div class="response-studio__payload-card">
              <div class="response-studio__payload-card-header">
                <span class="response-studio__payload-card-title">Expected Payload Schema</span>
                <div class="response-studio__payload-card-actions">
                  <button type="button" class="response-studio__beautify-btn" (click)="openJsonFormatter('schema')">
                    <app-icon name="code" [size]="12" />
                    <span>Format JSON</span>
                  </button>
                  <span class="response-studio__schema-lang">TypeScript / JSON Schema</span>
                </div>
              </div>

              <div class="response-studio__code-wrap response-studio__code-wrap--payload">
                <div class="response-studio__line-numbers">
                  @for (line of schemaLineNumbers(); track line) {
                    <span>{{ line }}</span>
                  }
                </div>
                <textarea
                  class="response-studio__textarea"
                  spellcheck="false"
                  placeholder="id: number;&#10;name: string;&#10;address?: string;&#10;tags?: string[];&#10;items?: &#123; id: number; title: string &#125;[];"
                  [value]="payloadSchemaValue(activeResponse)"
                  (input)="onSchemaInput($event)"
                ></textarea>
              </div>

              <div class="response-studio__schema-footer">
                <div class="response-studio__schema-syntax-help">
                  <button type="button" class="response-studio__syntax-pill" (click)="insertSchemaSnippet('id: number;\n')">id: number</button>
                  <button type="button" class="response-studio__syntax-pill" (click)="insertSchemaSnippet('name: string;\n')">name: string</button>
                  <button type="button" class="response-studio__syntax-pill" (click)="insertSchemaSnippet('address?: string;\n')">address?: string</button>
                  <button type="button" class="response-studio__syntax-pill" (click)="insertSchemaSnippet('tags?: string[];\n')">tags?: string[]</button>
                  <button type="button" class="response-studio__syntax-pill" (click)="insertSchemaSnippet('items?: &#123; id: number; title: string &#125;[];\n')">items: &#123; id: number &#125;[]</button>
                </div>
                @if (schemaSyntaxStatus(); as status) {
                  <span
                    class="response-studio__schema-status"
                    [class.response-studio__schema-status--err]="!status.valid"
                  >
                    {{ status.message }}
                  </span>
                }
              </div>
            </div>
          </div>
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

        @if (showJsonFormatterModal()) {
          <app-modal title="JSON Formatter & Validator" size="xl" (closed)="closeJsonFormatter()">
            <div class="json-formatter-dialog">
              <!-- Top Toolbar -->
              <div class="json-formatter-dialog__toolbar">
                <div class="json-formatter-dialog__tools">
                  <button type="button" class="json-formatter-dialog__tool-btn json-formatter-dialog__tool-btn--primary" (click)="formatInDialog(2)">
                    <app-icon name="code" [size]="12" />
                    <span>Format (2 spaces)</span>
                  </button>
                  <button type="button" class="json-formatter-dialog__tool-btn" (click)="formatInDialog(4)">
                    <span>4 spaces</span>
                  </button>
                  <button type="button" class="json-formatter-dialog__tool-btn" (click)="minifyInDialog()">
                    <span>Minify</span>
                  </button>
                  <button type="button" class="json-formatter-dialog__tool-btn" (click)="loadSampleInDialog()">
                    <span>Sample JSON</span>
                  </button>
                  <button type="button" class="json-formatter-dialog__tool-btn" (click)="clearInDialog()">
                    <app-icon name="trash" [size]="12" />
                    <span>Clear</span>
                  </button>
                </div>

                <div class="json-formatter-dialog__status-wrapper">
                  @if (formatterSuccess()) {
                    <div class="json-formatter-dialog__status json-formatter-dialog__status--ok">
                      <app-icon name="check" [size]="12" />
                      <span>Valid JSON</span>
                    </div>
                  } @else if (formatterErrorInfo(); as err) {
                    <div class="json-formatter-dialog__status json-formatter-dialog__status--err" [title]="err.message">
                      <span>⚠ JSON is not formatted properly</span>
                    </div>
                  }
                </div>
              </div>

              <!-- Side-by-Side Panes -->
              <div class="json-formatter-dialog__panes">
                <!-- Left Pane: Input / Raw JSON -->
                <div class="json-formatter-dialog__pane">
                  <div class="json-formatter-dialog__pane-header">
                    <div class="json-formatter-dialog__pane-title">
                      <span>Input JSON (Raw)</span>
                      <span class="json-formatter-dialog__pane-badge">{{ inputCharCount() }} chars</span>
                    </div>
                    <button
                      type="button"
                      class="json-formatter-dialog__pane-action"
                      (click)="clearInDialog()"
                      title="Clear input"
                    >
                      Clear
                    </button>
                  </div>
                  <div class="json-formatter-dialog__editor">
                    <textarea
                      class="json-formatter-dialog__textarea"
                      spellcheck="false"
                      placeholder="Paste or write your raw JSON here..."
                      [value]="formatterInputText()"
                      (input)="onFormatterInput($event)"
                    ></textarea>
                  </div>
                </div>

                <!-- Divider Arrow -->
                <div class="json-formatter-dialog__divider" aria-hidden="true">
                  <app-icon name="arrow-right" [size]="16" />
                </div>

                <!-- Right Pane: Formatted Output -->
                <div class="json-formatter-dialog__pane">
                  <div class="json-formatter-dialog__pane-header">
                    <div class="json-formatter-dialog__pane-title">
                      <span>Formatted Output</span>
                      @if (formatterSuccess()) {
                        <span class="json-formatter-dialog__pane-badge json-formatter-dialog__pane-badge--success">Formatted</span>
                      } @else if (formatterErrorInfo()) {
                        <span class="json-formatter-dialog__pane-badge json-formatter-dialog__pane-badge--error">Format Error</span>
                      }
                    </div>
                    <button
                      type="button"
                      class="json-formatter-dialog__pane-action json-formatter-dialog__pane-action--copy"
                      (click)="copyFormattedJson()"
                      title="Copy formatted JSON to clipboard"
                      [disabled]="!formatterSuccess() || !formatterOutputText().trim()"
                    >
                      @if (formatterCopied()) {
                        <app-icon name="check" [size]="12" />
                        <span>Copied!</span>
                      } @else {
                        <app-icon name="copy" [size]="12" />
                        <span>Copy</span>
                      }
                    </button>
                  </div>
                  <div class="json-formatter-dialog__editor">
                    @if (formatterErrorInfo(); as err) {
                      <div class="json-formatter-dialog__error-view">
                        <div class="json-formatter-dialog__error-header">
                          <div class="json-formatter-dialog__error-title-row">
                            <span class="json-formatter-dialog__error-pill">Syntax Error</span>
                            <h4 class="json-formatter-dialog__error-title">JSON is not formatted properly</h4>
                          </div>
                          <p class="json-formatter-dialog__error-subtitle">
                            Please format your JSON message. The parser encountered an invalid token.
                          </p>
                        </div>

                        <div class="json-formatter-dialog__error-card">
                          <div class="json-formatter-dialog__error-row">
                            <span class="json-formatter-dialog__error-tag">Problem:</span>
                            <span class="json-formatter-dialog__error-desc">{{ err.message }}</span>
                          </div>

                          @if (err.line !== undefined) {
                            <div class="json-formatter-dialog__error-row">
                              <span class="json-formatter-dialog__error-tag">Location:</span>
                              <span class="json-formatter-dialog__error-loc">
                                Line {{ err.line }}, Column {{ err.column }}
                              </span>
                            </div>
                          }
                        </div>

                        @if (err.snippet) {
                          <div class="json-formatter-dialog__error-snippet-box">
                            <div class="json-formatter-dialog__error-snippet-title">Error Context</div>
                            <pre class="json-formatter-dialog__error-snippet"><code>{{ err.snippet }}</code></pre>
                          </div>
                        }

                        <div class="json-formatter-dialog__error-hint">
                          <div class="json-formatter-dialog__error-hint-header">
                            <span>💡 How to fix</span>
                          </div>
                          <p class="json-formatter-dialog__error-hint-body">{{ err.suggestion }}</p>
                        </div>

                        <div class="json-formatter-dialog__error-autofix">
                          <button
                            type="button"
                            class="json-formatter-dialog__autofix-btn"
                            (click)="autoFixInDialog()"
                          >
                            <app-icon name="zap" [size]="12" />
                            <span>Auto-fix syntax (quotes & commas)</span>
                          </button>
                        </div>
                      </div>
                    } @else {
                      <textarea
                        class="json-formatter-dialog__textarea json-formatter-dialog__textarea--output"
                        spellcheck="false"
                        placeholder="Formatted JSON will appear here..."
                        [value]="formatterOutputText()"
                        (input)="onFormatterOutputChange($event)"
                      ></textarea>
                    }
                  </div>
                </div>
              </div>

              <!-- Dialog Footer Actions -->
              <div class="json-formatter-dialog__footer">
                <div class="json-formatter-dialog__hint">
                  <span>Click <strong>Implement</strong> to apply formatted JSON to your {{ formatterTarget() === 'body' ? 'Response Body' : 'Payload Schema' }}.</span>
                </div>
                <div class="json-formatter-dialog__actions">
                  <button
                    type="button"
                    class="json-formatter-dialog__btn json-formatter-dialog__btn--cancel"
                    (click)="closeJsonFormatter()"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    class="json-formatter-dialog__btn json-formatter-dialog__btn--implement"
                    [disabled]="!formatterSuccess() || !formatterOutputText().trim()"
                    (click)="implementFormattedJson()"
                  >
                    <app-icon name="check" [size]="12" />
                    <span>Implement</span>
                  </button>
                </div>
              </div>
            </div>
          </app-modal>
        }
      </div>
    }
  `,
  styleUrl: './response-editor.scss',
})
export class ResponseEditor {
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly apiClient = inject(MockApiClient);
  readonly bodyTextarea = viewChild<ElementRef<HTMLTextAreaElement>>('bodyTextarea');

  readonly responseInput = input<RouteResponse | null>(null);
  readonly responseChange = output<RouteResponse>();
  readonly environmentUuidInput = input<string>('');
  readonly routeMethodInput = input<string>('GET');

  readonly activeSubTab = signal<'status-body' | 'payload' | 'headers' | 'rules' | 'settings'>('status-body');
  readonly previewing = signal(false);
  readonly previewOutput = signal<string | null>(null);
  readonly previewWarning = signal<string | null>(null);
  readonly previewError = signal<string | null>(null);
  readonly bodyContent = signal('');

  // --- JSON Formatter Modal state ---
  readonly showJsonFormatterModal = signal(false);
  readonly formatterTarget = signal<'body' | 'schema'>('body');
  readonly formatterInputText = signal('');
  readonly formatterOutputText = signal('');
  readonly formatterErrorInfo = signal<JsonErrorInfo | null>(null);
  readonly formatterSuccess = signal(false);
  readonly formatterCopied = signal(false);
  readonly inputCharCount = computed(() => this.formatterInputText().length);

  private seedKey: string | null = null;
  private bodySeedText = '';
  private previewedSeedKey: string | null = null;

  readonly standardStatusCodes = [
    { code: 200, text: '200 - OK' },
    { code: 201, text: '201 - Created' },
    { code: 202, text: '202 - Accepted' },
    { code: 204, text: '204 - No Content' },
    { code: 301, text: '301 - Moved Permanently' },
    { code: 302, text: '302 - Found' },
    { code: 304, text: '304 - Not Modified' },
    { code: 400, text: '400 - Bad Request' },
    { code: 401, text: '401 - Unauthorized' },
    { code: 403, text: '403 - Forbidden' },
    { code: 404, text: '404 - Not Found' },
    { code: 405, text: '405 - Method Not Allowed' },
    { code: 406, text: '406 - Not Acceptable' },
    { code: 409, text: '409 - Conflict' },
    { code: 410, text: '410 - Gone' },
    { code: 422, text: '422 - Unprocessable Entity' },
    { code: 429, text: '429 - Too Many Requests' },
    { code: 500, text: '500 - Internal Server Error' },
    { code: 502, text: '502 - Bad Gateway' },
    { code: 503, text: '503 - Service Unavailable' },
    { code: 504, text: '504 - Gateway Timeout' },
  ];

  isStandardStatus(code: number): boolean {
    return this.standardStatusCodes.some((s) => s.code === code);
  }

  readonly lineNumbers = computed(() => {
    const text = this.bodyContent();
    const count = (text.match(/\n/g) || []).length + 1;
    return Array.from({ length: Math.max(count, 14) }, (_, i) => i + 1);
  });

  readonly isPostRoute = computed(() => {
    return (this.routeMethodInput() || '').toLowerCase() === 'post';
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
        this.cdr.markForCheck();
      }
    }, { allowSignalWrites: true });

    effect(() => {
      if (this.activeSubTab() === 'payload' && !this.isPostRoute()) {
        this.activeSubTab.set('status-body');
      }
    }, { allowSignalWrites: true });
  }

  bodySeedValue(): string {
    const activeResponse = this.responseInput();
    if (!activeResponse) return '';
    const currentKey = `${activeResponse.uuid}:${activeResponse.bodyType}`;
    if (this.seedKey !== currentKey) {
      this.seedKey = currentKey;
      this.bodySeedText = activeResponse.body;
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

  openJsonFormatter(target: 'body' | 'schema' = 'body'): void {
    this.formatterTarget.set(target);
    const activeResponse = this.responseInput();
    let current = '';

    if (target === 'body') {
      current = this.bodyTextarea()?.nativeElement.value ?? activeResponse?.body ?? '';
    } else {
      current = this.payloadSchemaValue();
    }

    this.formatterInputText.set(current);
    this.formatterCopied.set(false);
    this.processFormatterInput(current);
    this.showJsonFormatterModal.set(true);
  }

  closeJsonFormatter(): void {
    this.showJsonFormatterModal.set(false);
  }

  private processFormatterInput(val: string, spaces = 2): void {
    if (!val.trim()) {
      this.formatterOutputText.set('');
      this.formatterErrorInfo.set(null);
      this.formatterSuccess.set(false);
      return;
    }
    try {
      const parsed = JSON.parse(val);
      this.formatterOutputText.set(JSON.stringify(parsed, null, spaces));
      this.formatterErrorInfo.set(null);
      this.formatterSuccess.set(true);
    } catch (err) {
      this.formatterOutputText.set('');
      this.formatterSuccess.set(false);
      this.formatterErrorInfo.set(analyzeJsonError(val, err));
    }
  }

  formatInDialog(spaces = 2): void {
    this.processFormatterInput(this.formatterInputText(), spaces);
  }

  minifyInDialog(): void {
    const text = this.formatterInputText().trim();
    if (!text) return;
    try {
      const parsed = JSON.parse(text);
      this.formatterOutputText.set(JSON.stringify(parsed));
      this.formatterErrorInfo.set(null);
      this.formatterSuccess.set(true);
    } catch (err) {
      this.formatterOutputText.set('');
      this.formatterSuccess.set(false);
      this.formatterErrorInfo.set(analyzeJsonError(text, err));
    }
  }

  loadSampleInDialog(): void {
    const sample = {
      status: 'success',
      code: 200,
      data: {
        id: 101,
        name: 'Sahayak Mock API',
        version: '1.0.0',
        active: true,
        tags: ['api', 'mock', 'developer-tool'],
      },
      timestamp: new Date().toISOString(),
    };
    const formatted = JSON.stringify(sample, null, 2);
    this.formatterInputText.set(formatted);
    this.formatterOutputText.set(formatted);
    this.formatterErrorInfo.set(null);
    this.formatterSuccess.set(true);
  }

  clearInDialog(): void {
    this.formatterInputText.set('');
    this.formatterOutputText.set('');
    this.formatterErrorInfo.set(null);
    this.formatterSuccess.set(false);
  }

  onFormatterInput(event: Event): void {
    const val = (event.target as HTMLTextAreaElement).value;
    this.formatterInputText.set(val);
    this.processFormatterInput(val);
  }

  onFormatterOutputChange(event: Event): void {
    const val = (event.target as HTMLTextAreaElement).value;
    this.formatterOutputText.set(val);
  }

  autoFixInDialog(): void {
    const raw = this.formatterInputText();
    if (!raw.trim()) return;

    // 1. Remove trailing commas before } or ]
    let fixed = raw.replace(/,\s*([}\]])/g, '$1');
    // 2. Replace single quotes with double quotes around keys and strings
    fixed = fixed.replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, '"$1"');

    this.formatterInputText.set(fixed);
    this.processFormatterInput(fixed);
  }

  async copyFormattedJson(): Promise<void> {
    const text = this.formatterOutputText().trim();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      this.formatterCopied.set(true);
      setTimeout(() => this.formatterCopied.set(false), 2000);
    } catch {
      // Fallback if clipboard API not available
    }
  }

  implementFormattedJson(): void {
    let text = this.formatterOutputText().trim();
    if (!text) {
      text = this.formatterInputText().trim();
    }

    if (text) {
      try {
        const parsed = JSON.parse(text);
        text = JSON.stringify(parsed, null, 2);
      } catch {
        // Keep as-is if unparseable
      }
    }

    const activeResponse = this.responseInput();
    if (activeResponse) {
      if (this.formatterTarget() === 'body') {
        const el = this.bodyTextarea()?.nativeElement;
        if (el) {
          el.value = text;
        }
        this.bodySeedText = text;
        this.bodyContent.set(text);

        this.responseChange.emit({
          ...activeResponse,
          body: text,
          bodyType: 'INLINE',
        });
      } else {
        this.updatePayloadValidation({
          schema: text,
          enabled: text.trim().length > 0,
        });
      }
    }

    this.closeJsonFormatter();
  }

  setBodyTypeDirect(bodyType: 'INLINE' | 'FILE' | 'NONE'): void {
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

  setStringField(field: 'label' | 'filePath' | 'body', valueOrEvent: Event | string): void {
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

  payloadSchemaValue(activeResponse?: RouteResponse | null): string {
    const resp = activeResponse ?? this.responseInput();
    if (!resp) return SAMPLE_PAYLOAD_SCHEMA;
    if (resp.payloadValidation?.schema !== undefined && resp.payloadValidation.schema !== null) {
      return resp.payloadValidation.schema;
    }
    return SAMPLE_PAYLOAD_SCHEMA;
  }

  readonly schemaLineNumbers = computed(() => {
    const text = this.payloadSchemaValue();
    const count = (text.match(/\n/g) || []).length + 1;
    return Array.from({ length: Math.max(count, 8) }, (_, i) => i + 1);
  });

  readonly schemaSyntaxStatus = computed(() => {
    const schema = (this.payloadSchemaValue() ?? '').trim();
    if (!schema) {
      return { valid: true, message: 'No schema defined (all payloads accepted)' };
    }
    try {
      parseSchema(schema);
      return { valid: true, message: '✓ Valid schema definition' };
    } catch (e) {
      return { valid: false, message: `⚠ ${e instanceof Error ? e.message : 'Invalid schema syntax'}` };
    }
  });

  updatePayloadValidation(patch: Partial<PayloadValidation>): void {
    const active = this.responseInput();
    if (!active) return;
    const current = active.payloadValidation ?? {
      enabled: true,
      schema: SAMPLE_PAYLOAD_SCHEMA,
      errorStatus: 400,
      errorBody: DEFAULT_PAYLOAD_ERROR_BODY,
    };
    const updated: PayloadValidation = {
      ...current,
      ...patch,
    };
    this.responseChange.emit({
      ...active,
      payloadValidation: updated,
    });
  }

  onSchemaInput(event: Event): void {
    const val = (event.target as HTMLTextAreaElement).value;
    this.updatePayloadValidation({
      enabled: val.trim().length > 0,
      schema: val,
      errorStatus: 400,
      errorBody: DEFAULT_PAYLOAD_ERROR_BODY,
    });
  }

  insertSchemaSnippet(snippet: string): void {
    const current = this.payloadSchemaValue();
    const updated = current ? `${current.trimEnd()}\n${snippet}` : snippet;
    this.updatePayloadValidation({
      enabled: true,
      schema: updated,
      errorStatus: 400,
      errorBody: DEFAULT_PAYLOAD_ERROR_BODY,
    });
  }
}
