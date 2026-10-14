import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DataBucketList } from './data-bucket-list';
import { createDataBucket } from '../../../core/defaults';
import { DataBucket } from '../../../core/types';

describe('DataBucketList', () => {
  function buildFixture(initialBuckets: DataBucket[] = [], referenceUuids: string[] = []) {
    const emittedBuckets: DataBucket[][] = [];
    const emittedSelections: string[] = [];
    const fixture: ComponentFixture<DataBucketList> = TestBed.createComponent(DataBucketList);
    fixture.componentRef.setInput('bucketsInput', initialBuckets);
    fixture.componentRef.setInput('referencesInput', referenceUuids);
    // Controlled: echo emissions back into the input.
    fixture.componentInstance.bucketsChange.subscribe((nextBuckets) => {
      emittedBuckets.push(nextBuckets);
      fixture.componentRef.setInput('bucketsInput', nextBuckets);
    });
    fixture.componentInstance.selectChange.subscribe((bucketUuid) => emittedSelections.push(bucketUuid));
    fixture.detectChanges();
    return { fixture, emittedBuckets, emittedSelections };
  }

  it('renders a row per bucket with its name and JSON shape label', () => {
    const objectArrayBucket = createDataBucket('orders');
    const { fixture } = buildFixture([objectArrayBucket]);
    expect(fixture.nativeElement.querySelectorAll('.data-bucket-list__row').length).toBe(1);
    expect(fixture.nativeElement.querySelector('.data-bucket-list__name')?.textContent).toContain('orders');
    expect(fixture.nativeElement.querySelector('.data-bucket-list__kind')?.textContent).toContain('array of objects');
  });

  it('labels different JSON shapes correctly', () => {
    const { fixture } = buildFixture([]);
    const labeler = fixture.componentInstance as { bucketKindLabel(text: string): string };
    expect(labeler.bucketKindLabel('[{"a":1}]')).toBe('array of objects');
    expect(labeler.bucketKindLabel('[1,2,3]')).toBe('array');
    expect(labeler.bucketKindLabel('{"a":1}')).toBe('object');
    expect(labeler.bucketKindLabel('"hi"')).toBe('primitive');
    expect(labeler.bucketKindLabel('not json')).toBe('raw text');
  });

  it('adds a bucket with the next free name and focuses it', () => {
    const existingBucket = createDataBucket('items');
    const { fixture, emittedBuckets, emittedSelections } = buildFixture([existingBucket]);
    (fixture.nativeElement.querySelector('.data-bucket-list__add') as HTMLButtonElement).click();
    const nextBuckets = emittedBuckets.at(-1);
    expect(nextBuckets?.length).toBe(2);
    const addedBucket = nextBuckets?.[1];
    expect(addedBucket?.name).toBe('items-2');
    expect(emittedSelections).toEqual([addedBucket?.uuid]);
  });

  it('duplicates a bucket with a fresh uuid and a -copy name', () => {
    const sourceBucket = createDataBucket('users');
    const { fixture, emittedBuckets } = buildFixture([sourceBucket]);
    const duplicateButton = fixture.nativeElement.querySelector('.data-bucket-list__row-actions button');
    (duplicateButton as HTMLButtonElement).click();
    const nextBuckets = emittedBuckets.at(-1);
    expect(nextBuckets?.length).toBe(2);
    const copiedBucket = nextBuckets?.[1];
    expect(copiedBucket?.uuid).not.toBe(sourceBucket.uuid);
    expect(copiedBucket?.name).toBe('users-copy');
  });

  it('warns about references before deleting a referenced bucket', () => {
    const sourceBucket = createDataBucket('linked');
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { fixture, emittedBuckets } = buildFixture([sourceBucket], [sourceBucket.uuid, sourceBucket.uuid]);
    const deleteButton = fixture.nativeElement.querySelector('.data-bucket-list__delete') as HTMLButtonElement;
    deleteButton.click();
    const confirmText = confirmSpy.mock.calls[0]?.[0] as string;
    expect(confirmText).toContain('referenced by 2');
    expect(emittedBuckets.at(-1)).toEqual([]);
  });
});
