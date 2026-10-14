import { Component, ElementRef, inject, input, output, viewChild } from '@angular/core';
import { DataBucket } from '../../../core/types';
import { HelperPicker } from '../../../shared/components/helper-picker/helper-picker';
import { TemplateHint } from '../../../shared/components/template-hint/template-hint';

/**
 * F11 — data bucket editor (name, templated content, JSON indicator).
 * Block: .data-bucket-editor
 *
 * Controlled clone-emitter like the other editors. The content textarea is
 * uncontrolled (seeded per bucket) so the caret survives store echoes;
 * every keystroke is committed via `bucketChange`.
 */
@Component({
  selector: 'app-data-bucket-editor',
  imports: [HelperPicker, TemplateHint],
  template: `
    @if (bucketInput(); as activeBucket) {
      <div class="data-bucket-editor">
      <div class="data-bucket-editor__meta">
        <label class="data-bucket-editor__field">
          <span class="data-bucket-editor__label">Bucket name</span>
          <input
            #nameInput
            type="text"
            class="data-bucket-editor__name-input"
            placeholder="items"
            [value]="nameSeedValue()"
            (input)="commitName()"
          />
        </label>
        <span
          class="data-bucket-editor__parse"
          [class.data-bucket-editor__parse--json]="jsonKind() !== 'raw'"
        >
          {{ jsonKind() === 'raw' ? 'raw text (not JSON)' : 'valid JSON — ' + jsonKind() }}
        </span>
      </div>

      <p class="data-bucket-editor__hint">
        Content is templated once at generation time (server start / first reference) — helpers run then,
        not per request. CRUD routes read and write this bucket at runtime.
      </p>

      <div class="data-bucket-editor__toolbar">
        <app-helper-picker (insertSnippet)="insertSnippetIntoContent($event)" />
      </div>

      <textarea
        #contentTextarea
        class="data-bucket-editor__content-textarea"
        rows="10"
        spellcheck="false"
        placeholder='[{"id": 1, "name": "use the helper picker"}]'
        [value]="contentSeedValue()"
        (input)="commitContent()"
      ></textarea>
      <app-template-hint (insertSnippet)="insertSnippetIntoContent($event)" />
      </div>
    }
  `,
  styleUrl: './data-bucket-editor.scss',
})
export class DataBucketEditor {
  private readonly nameInputRef = viewChild<ElementRef>('nameInput');
  private readonly contentTextareaRef = viewChild<ElementRef>('contentTextarea');

  readonly bucketInput = input<DataBucket | null>(null);
  readonly bucketChange = output<DataBucket>();

  private seededBucketUuid: string | null = null;
  private nameSeedText = '';
  private contentSeedText = '';

  // --- seeds (uncontrolled fields) ---------------------------------------

  nameSeedValue(): string {
    this.ensureSeed();
    return this.nameSeedText;
  }

  contentSeedValue(): string {
    this.ensureSeed();
    return this.contentSeedText;
  }

  private ensureSeed(): void {
    const activeBucket = this.bucketInput();
    if (!activeBucket || this.seededBucketUuid === activeBucket.uuid) return;
    this.seededBucketUuid = activeBucket.uuid;
    this.nameSeedText = activeBucket.name;
    this.contentSeedText = activeBucket.content;
  }

  // --- commits -------------------------------------------------------------

  commitName(): void {
    const activeBucket = this.bucketInput();
    const nameElement = this.nameInputRef()?.nativeElement as HTMLInputElement | null;
    if (!activeBucket || !nameElement) return;
    this.bucketChange.emit({ ...activeBucket, name: nameElement.value });
  }

  commitContent(): void {
    const activeBucket = this.bucketInput();
    const contentElement = this.contentTextareaRef()?.nativeElement as HTMLTextAreaElement | null;
    if (!activeBucket || !contentElement) return;
    this.bucketChange.emit({ ...activeBucket, content: contentElement.value });
  }

  insertSnippetIntoContent(snippet: string): void {
    const contentElement = this.contentTextareaRef()?.nativeElement as HTMLTextAreaElement | null;
    if (!contentElement) return;
    const insertPosition = contentElement.selectionStart ?? contentElement.value.length;
    const endPosition = contentElement.selectionEnd ?? insertPosition;
    const currentText = contentElement.value;
    const nextText = currentText.slice(0, insertPosition) + snippet + currentText.slice(endPosition);
    contentElement.value = nextText;
    contentElement.focus();
    contentElement.selectionStart = insertPosition;
    contentElement.selectionEnd = insertPosition + snippet.length;
    // Programmatic .value sets don't fire events — commit manually.
    contentElement.dispatchEvent(new Event('input'));
  }

  // --- JSON indicator --------------------------------------------------------

  /** 'raw' when the content does not parse; otherwise the JSON shape. */
  jsonKind(): string {
    const activeBucket = this.bucketInput();
    if (!activeBucket) return 'raw';
    let parsedContent: unknown;
    try {
      parsedContent = JSON.parse(activeBucket.content);
    } catch {
      return 'raw';
    }
    if (Array.isArray(parsedContent)) {
      const nonNullElements = parsedContent.filter((element) => element !== null);
      if (nonNullElements.length > 0 && nonNullElements.every((element) => typeof element === 'object')) {
        return 'array of objects';
      }
      return 'array';
    }
    if (typeof parsedContent === 'object' && parsedContent !== null) return 'object';
    return 'primitive';
  }
}
