import { Component, ElementRef, effect, inject, input, output, signal, viewChild } from '@angular/core';
import { DataBucket, KeyValue, RouteResponse, RouteRule, RulesOperator } from '../../../core/types';
import { MockApiClient } from '../../../core/mock-api.client';
import { KvList } from '../../../shared/components/kv-list/kv-list';
import { RuleEditor } from '../../../shared/components/rule-editor/rule-editor';
import { SelectValueSync } from '../../../shared/directives/select-value-sync.directive';
import { HelperPicker } from '../../../shared/components/helper-picker/helper-picker';
import { TemplateHint } from '../../../shared/components/template-hint/template-hint';

/**
 * F10 — response editor (per response). Block: .response-editor
 *
 * Controlled: renders `responseInput` and emits the mutated clone on every
 * field change. The INLINE body textarea is intentionally *uncontrolled*
 * after the first render (caret position must survive store echoes), so
 * "preview render" and "add response" read the live textarea value.
 */
@Component({
  selector: 'app-response-editor',
  imports: [KvList, RuleEditor, HelperPicker, TemplateHint, SelectValueSync],
  template: `
    @if (responseInput(); as activeResponse) {
      <div class="response-editor">
      <!-- metadata row -->
      <div class="response-editor__meta">
        <label class="response-editor__field">
          <span class="response-editor__label">Label</span>
          <input
            type="text"
            class="response-editor__label-input"
            placeholder="e.g. Success"
            [value]="activeResponse.label"
            (change)="setStringField('label', $event)"
          />
        </label>

        <label class="response-editor__field">
          <span class="response-editor__label">Status</span>
          <input
            type="number"
            class="response-editor__status-input"
            min="100"
            max="599"
            [value]="activeResponse.statusCode"
            (change)="setStatusField($event)"
          />
        </label>

        <label class="response-editor__field">
          <span class="response-editor__label">Latency (ms)</span>
          <input
            type="number"
            class="response-editor__latency-input"
            min="0"
            [value]="activeResponse.latency"
            (change)="setLatencyField($event)"
          />
        </label>
      </div>

      <!-- headers -->
      <div class="response-editor__section">
        <p class="response-editor__section-label">Response headers</p>
        <app-kv-list
          [itemsInput]="activeResponse.headers"
          keyPlaceholderInput="Header name"
          valuePlaceholderInput="Value (templating ok)"
          (itemsChange)="setHeaders($event)"
        />
      </div>

      <!-- body -->
      <div class="response-editor__section">
        <div class="response-editor__body-head">
          <p class="response-editor__section-label">Body</p>
          <select
            class="response-editor__body-type"
            [value]="activeResponse.bodyType"
            (change)="setBodyType($event)"
            aria-label="Body type"
          >
            <option value="INLINE">Inline</option>
            <option value="FILE">File</option>
            <option value="DATABUCKET">Data bucket</option>
            <option value="NONE">None</option>
          </select>
        </div>

        @switch (activeResponse.bodyType) {
          @case ('INLINE') {
            <div class="response-editor__inline">
              <div class="response-editor__inline-toolbar">
                <app-helper-picker (insertSnippet)="insertSnippetIntoBody($event)" />
              </div>
              <textarea
                #bodyTextarea
                class="response-editor__body-textarea"
                rows="8"
                spellcheck="false"
                placeholder='{"name": "use the helper picker", "id": "…"}'
                [value]="bodySeedValue()"
                (input)="commitBodyText()"
              ></textarea>
              <app-template-hint (insertSnippet)="insertSnippetIntoBody($event)" />
              <div class="response-editor__preview-row">
                <button
                  class="response-editor__preview-btn"
                  type="button"
                  [disabled]="previewing()"
                  (click)="previewBody()"
                >
                  {{ previewing() ? 'Rendering…' : '▶ Preview render' }}
                </button>
              </div>
              @if (previewOutput(); as previewResult) {
                <div class="response-editor__preview">
                  <pre class="response-editor__preview-output">{{ previewResult }}</pre>
                </div>
              }
              @if (previewWarning(); as previewWarningText) {
                <p class="response-editor__preview-warning">{{ previewWarningText }}</p>
              }
              @if (previewError(); as previewErrorText) {
                <p class="response-editor__preview-error">{{ previewErrorText }}</p>
              }
            </div>
          }

          @case ('FILE') {
            <div class="response-editor__file">
              <input
                type="text"
                class="response-editor__file-input"
                placeholder="/var/www/templates/payload.json (templated)"
                [value]="activeResponse.filePath"
                (change)="setStringField('filePath', $event)"
              />
              <p class="response-editor__hint">
                The file is read from the mock server's filesystem at request time; its content is templated.
              </p>
            </div>
          }

          @case ('DATABUCKET') {
            <div class="response-editor__bucket">
              <select
                class="response-editor__bucket-select"
                [value]="activeResponse.databucketId"
                [syncSelectValue]="activeResponse.databucketId"
                (change)="setStringField('databucketId', $event)"
              >
                <option value="" disabled>Select bucket…</option>
                @for (bucket of bucketsInput(); track bucket.uuid) {
                  <option [value]="bucket.uuid">{{ bucket.name }}</option>
                }
              </select>
              <p class="response-editor__hint">
                The bucket's generated content is served raw (no templating at render time).
              </p>
            </div>
          }

          @case ('NONE') {
            <p class="response-editor__hint">Empty body — headers and status only.</p>
          }
        }
      </div>

      <!-- rules -->
      <div class="response-editor__section">
        <p class="response-editor__section-label">Match rules</p>
        <app-rule-editor
          [rulesInput]="activeResponse.rules"
          [operatorInput]="activeResponse.rulesOperator"
          [bucketsInput]="bucketsInput()"
          (rulesChange)="setRules($event)"
          (operatorChange)="setRulesOperator($event)"
        />
      </div>
      </div>
    }
  `,
  styleUrl: './response-editor.scss',
})
export class ResponseEditor {
  private readonly apiClient = inject(MockApiClient);
  readonly bodyTextarea = viewChild<ElementRef<HTMLTextAreaElement>>('bodyTextarea');
  /**
   * Seed state for the uncontrolled body textarea. Keyed on
   * `uuid:bodyType` because the @switch destroys/recreates the element
   * when the body type changes back to INLINE.
   */
  private seedKey: string | null = null;
  private bodySeedText = '';

  readonly responseInput = input<RouteResponse | null>(null);
  readonly bucketsInput = input<DataBucket[]>([]);
  readonly responseChange = output<RouteResponse>();
  readonly environmentUuidInput = input<string>('');

  readonly previewing = signal(false);
  readonly previewOutput = signal<string | null>(null);
  readonly previewWarning = signal<string | null>(null);
  readonly previewError = signal<string | null>(null);

  /** Seed key the current preview state belongs to (effects run outside render). */
  private previewedSeedKey: string | null = null;

  constructor() {
    // A preview only makes sense for the response (and body type) it was
    // rendered for — drop it whenever the active response changes. Effects
    // run outside render, so the signal writes here are legal (unlike doing
    // them from bodySeedValue(), which the template calls during render).
    effect(() => {
      const activeResponse = this.responseInput();
      const nextSeedKey = activeResponse ? `${activeResponse.uuid}:${activeResponse.bodyType}` : null;
      if (this.previewedSeedKey !== nextSeedKey) {
        this.previewedSeedKey = nextSeedKey;
        this.resetPreview();
      }
    });
  }

  /**
   * Pure read of the uncontrolled textarea's seed. The textarea itself is
   * keyed by the same `uuid:bodyType` (the @switch recreates it), so the
   * first render after a key change shows the store's body.
   */
  bodySeedValue(): string {
    const activeResponse = this.responseInput();
    if (!activeResponse) return this.bodySeedText;
    const nextSeedKey = `${activeResponse.uuid}:${activeResponse.bodyType}`;
    if (this.seedKey !== nextSeedKey) {
      this.seedKey = nextSeedKey;
      this.bodySeedText = activeResponse.body;
    }
    return this.bodySeedText;
  }

  // --- metadata ----------------------------------------------------------

  setStringField(field: 'label' | 'filePath' | 'databucketId', changeEvent: Event): void {
    const sourceResponse = this.responseInput();
    if (!sourceResponse) return;
    const nextValue = (changeEvent.target as HTMLInputElement | HTMLSelectElement).value;
    this.responseChange.emit({ ...sourceResponse, [field]: nextValue });
  }

  setStatusField(changeEvent: Event): void {
    const sourceResponse = this.responseInput();
    if (!sourceResponse) return;
    const parsedStatus = Number.parseInt((changeEvent.target as HTMLInputElement).value, 10);
    if (!Number.isFinite(parsedStatus)) return;
    const clampedStatus = Math.min(599, Math.max(100, parsedStatus));
    this.responseChange.emit({ ...sourceResponse, statusCode: clampedStatus });
  }

  setLatencyField(changeEvent: Event): void {
    const sourceResponse = this.responseInput();
    if (!sourceResponse) return;
    const parsedLatency = Number.parseInt((changeEvent.target as HTMLInputElement).value, 10);
    const clampedLatency = Number.isFinite(parsedLatency) ? Math.max(0, parsedLatency) : 0;
    this.responseChange.emit({ ...sourceResponse, latency: clampedLatency });
  }

  setHeaders(nextHeaders: KeyValue[]): void {
    const sourceResponse = this.responseInput();
    if (!sourceResponse) return;
    this.responseChange.emit({ ...sourceResponse, headers: nextHeaders });
  }

  setBodyType(changeEvent: Event): void {
    const sourceResponse = this.responseInput();
    if (!sourceResponse) return;
    const nextBodyType = (changeEvent.target as HTMLSelectElement).value as RouteResponse['bodyType'];
    // Commit whatever is in the live textarea before the switch hides it.
    const bodyElement = this.bodyTextarea()?.nativeElement;
    const liveBodyText =
      sourceResponse.bodyType === 'INLINE' && bodyElement ? bodyElement.value : sourceResponse.body;
    this.responseChange.emit({ ...sourceResponse, bodyType: nextBodyType, body: liveBodyText });
    this.resetPreview();
  }

  setRules(nextRules: RouteRule[]): void {
    const sourceResponse = this.responseInput();
    if (!sourceResponse) return;
    this.responseChange.emit({ ...sourceResponse, rules: nextRules });
  }

  setRulesOperator(nextOperator: RulesOperator): void {
    const sourceResponse = this.responseInput();
    if (!sourceResponse) return;
    this.responseChange.emit({ ...sourceResponse, rulesOperator: nextOperator });
  }

  // --- body editing --------------------------------------------------------

  /** Commit the live (uncontrolled) textarea text into the store. */
  commitBodyText(): void {
    const sourceResponse = this.responseInput();
    const bodyElement = this.bodyTextarea()?.nativeElement;
    if (!sourceResponse || !bodyElement) return;
    this.responseChange.emit({ ...sourceResponse, body: bodyElement.value });
  }

  /** Insert a helper snippet at the textarea caret (or end). */
  insertSnippetIntoBody(snippet: string): void {
    const bodyElement = this.bodyTextarea()?.nativeElement;
    if (!bodyElement) return;
    const insertPosition = bodyElement.selectionStart ?? bodyElement.value.length;
    const endPosition = bodyElement.selectionEnd ?? insertPosition;
    const currentText = bodyElement.value;
    const nextText = currentText.slice(0, insertPosition) + snippet + currentText.slice(endPosition);
    bodyElement.value = nextText;
    bodyElement.focus();
    bodyElement.selectionStart = insertPosition;
    bodyElement.selectionEnd = insertPosition + snippet.length;
    // Programmatic .value sets don't fire events — commit manually.
    bodyElement.dispatchEvent(new Event('input'));
  }

  /** Call the preview-template endpoint with the live textarea content. */
  async previewBody(): Promise<void> {
    const sourceResponse = this.responseInput();
    if (!sourceResponse || this.previewing()) return;
    const bodyElement = this.bodyTextarea()?.nativeElement;
    const templateText = bodyElement?.value ?? sourceResponse.body;
    this.previewing.set(true);
    this.previewOutput.set(null);
    this.previewWarning.set(null);
    this.previewError.set(null);
    try {
      const previewResult = await this.apiClient.previewTemplate(this.environmentUuidInput(), templateText);
      this.previewOutput.set(previewResult.output);
      this.previewWarning.set(
        previewResult.warnings.length > 0 ? previewResult.warnings.join(' · ') : null,
      );
    } catch (caught) {
      this.previewError.set(caught instanceof Error ? caught.message : 'Preview failed');
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
