import { Component, input, output } from '@angular/core';
import { DataBucket } from '../../../core/types';
import { createDataBucket } from '../../../core/defaults';
import { IconComponent } from '../../../shared/components/icon/icon.component';

/**
 * Data bucket list component. Block: .data-bucket-list
 */
@Component({
  selector: 'app-data-bucket-list',
  imports: [IconComponent],
  template: `
    <div class="data-bucket-list">
      <header class="data-bucket-list__head">
        <h4 class="data-bucket-list__heading">Data buckets</h4>
        <button class="data-bucket-list__add" type="button" (click)="addBucket()">
          <app-icon name="plus" [size]="12" />
          <span>Add bucket</span>
        </button>
      </header>

      @for (bucketRow of bucketsInput(); track bucketRow.uuid) {
        <div
          class="data-bucket-list__row"
          [class.data-bucket-list__row--active]="activeUuidInput() === bucketRow.uuid"
          (click)="selectChange.emit(bucketRow.uuid)"
          role="button"
          tabindex="0"
        >
          <span class="data-bucket-list__name">{{ bucketRow.name || '(unnamed)' }}</span>
          <span class="data-bucket-list__kind">{{ bucketKindLabel(bucketRow.content) }}</span>
          <span class="data-bucket-list__size">{{ bucketRow.content.length }} chars</span>
          <span class="data-bucket-list__row-actions" (click)="$event.stopPropagation()">
            <button type="button" title="Duplicate bucket" (click)="duplicateBucket(bucketRow)">
              <app-icon name="copy" [size]="12" />
            </button>
            <button
              type="button"
              title="Delete bucket"
              class="data-bucket-list__delete"
              (click)="deleteBucket(bucketRow)"
            >
              <app-icon name="trash" [size]="12" />
            </button>
          </span>
        </div>
      } @empty {
        <p class="data-bucket-list__empty">
          No buckets configured. Create a bucket to power mock CRUD stores or reference with <code>data "bucket" "path"</code>.
        </p>
      }
    </div>
  `,
  styleUrl: './data-bucket-list.scss',
})
export class DataBucketList {
  readonly bucketsInput = input<DataBucket[]>([]);
  /** uuids referenced by responses (databucketId) + CRUD routes. */
  readonly referencesInput = input<string[]>([]);
  readonly bucketsChange = output<DataBucket[]>();
  /** Bucket whose editor should be focused (row click). */
  readonly selectChange = output<string>();
  /** Highlighted row (the one open in the editor). */
  readonly activeUuidInput = input<string | null>(null);

  addBucket(): void {
    const sourceBuckets = this.bucketsInput();
    const freshName = nextFreeBucketName(sourceBuckets, 'items');
    const newBucket = createDataBucket(freshName);
    this.bucketsChange.emit([...sourceBuckets, newBucket]);
    this.selectChange.emit(newBucket.uuid);
  }

  duplicateBucket(sourceBucket: DataBucket): void {
    const cloneBucket = structuredClone(sourceBucket);
    cloneBucket.uuid = crypto.randomUUID();
    cloneBucket.name = nextFreeBucketName(this.bucketsInput(), sourceBucket.name + '-copy');
    this.bucketsChange.emit([...this.bucketsInput(), cloneBucket]);
  }

  deleteBucket(bucketRow: DataBucket): void {
    const referenceCount = this.referenceCountFor(bucketRow.uuid);
    const warningText =
      referenceCount > 0
        ? `Bucket "${bucketRow.name}" is referenced by ${referenceCount} response(s)/route(s). Delete anyway?`
        : `Delete bucket "${bucketRow.name}"?`;
    if (!window.confirm(warningText)) return;
    this.bucketsChange.emit(this.bucketsInput().filter((otherBucket) => otherBucket.uuid !== bucketRow.uuid));
  }

  /** How many databucket references (responses + CRUD routes) point here. */
  referenceCountFor(bucketUuid: string): number {
    return this.referencesInput().filter((reference) => reference === bucketUuid).length;
  }

  /** Human label for the JSON shape, for the list row. */
  bucketKindLabel(contentText: string): string {
    try {
      const parsedContent: unknown = JSON.parse(contentText);
      if (Array.isArray(parsedContent)) {
        const nonNullElements = parsedContent.filter((element) => element !== null);
        if (nonNullElements.length > 0 && nonNullElements.every((element) => typeof element === 'object')) {
          return 'array of objects';
        }
        return 'array';
      }
      if (typeof parsedContent === 'object' && parsedContent !== null) return 'object';
      return 'primitive';
    } catch {
      return 'raw text';
    }
  }
}

function nextFreeBucketName(existingBuckets: DataBucket[], baseName: string): string {
  const usedNames = new Set(existingBuckets.map((bucket) => bucket.name));
  if (!usedNames.has(baseName)) return baseName;
  let candidateIndex = 2;
  while (usedNames.has(`${baseName}-${candidateIndex}`)) candidateIndex++;
  return `${baseName}-${candidateIndex}`;
}
