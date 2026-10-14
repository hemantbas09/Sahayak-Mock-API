import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DataBucketEditor } from './data-bucket-editor';
import { createDataBucket } from '../../../core/defaults';
import { DataBucket } from '../../../core/types';

describe('DataBucketEditor', () => {
  function buildFixture(initialBucket: DataBucket | null) {
    const emittedBuckets: DataBucket[] = [];
    const fixture: ComponentFixture<DataBucketEditor> = TestBed.createComponent(DataBucketEditor);
    fixture.componentRef.setInput('bucketInput', initialBucket);
    // Controlled: echo emissions back into the input.
    fixture.componentInstance.bucketChange.subscribe((nextBucket) => {
      emittedBuckets.push(nextBucket);
      fixture.componentRef.setInput('bucketInput', nextBucket);
    });
    fixture.detectChanges();
    return { fixture, emittedBuckets };
  }

  it('seeds the name and content inputs from the bucket', () => {
    const sourceBucket = createDataBucket('users');
    const { fixture } = buildFixture(sourceBucket);
    const nameInput = fixture.nativeElement.querySelector('.data-bucket-editor__name-input') as HTMLInputElement;
    const contentTextarea = fixture.nativeElement.querySelector(
      '.data-bucket-editor__content-textarea',
    ) as HTMLTextAreaElement;
    expect(nameInput.value).toBe('users');
    expect(contentTextarea.value).toBe(sourceBucket.content);
  });

  it('commits a name change on input, keeping the uuid', () => {
    const sourceBucket = createDataBucket('users');
    const { fixture, emittedBuckets } = buildFixture(sourceBucket);
    const nameInput = fixture.nativeElement.querySelector('.data-bucket-editor__name-input') as HTMLInputElement;
    nameInput.value = 'customers';
    nameInput.dispatchEvent(new Event('input'));
    expect(emittedBuckets.at(-1)?.name).toBe('customers');
    expect(emittedBuckets.at(-1)?.uuid).toBe(sourceBucket.uuid);
  });

  it('commits a content change on input', () => {
    const sourceBucket = createDataBucket('users');
    const { fixture, emittedBuckets } = buildFixture(sourceBucket);
    const contentTextarea = fixture.nativeElement.querySelector(
      '.data-bucket-editor__content-textarea',
    ) as HTMLTextAreaElement;
    contentTextarea.value = '[{"id": 9}]';
    contentTextarea.dispatchEvent(new Event('input'));
    expect(emittedBuckets.at(-1)?.content).toBe('[{"id": 9}]');
  });

  it('shows the JSON shape indicator for the current content', () => {
    const objectArrayBucket = createDataBucket('users');
    const { fixture } = buildFixture(objectArrayBucket);
    expect(fixture.nativeElement.querySelector('.data-bucket-editor__parse')?.textContent).toContain(
      'array of objects',
    );
  });

  it('switches the indicator to raw text when the content no longer parses', () => {
    const sourceBucket = createDataBucket('users');
    const { fixture, emittedBuckets } = buildFixture(sourceBucket);
    const contentTextarea = fixture.nativeElement.querySelector(
      '.data-bucket-editor__content-textarea',
    ) as HTMLTextAreaElement;
    contentTextarea.value = 'definitely not json';
    contentTextarea.dispatchEvent(new Event('input'));
    fixture.detectChanges(); // echo the emission back into the DOM
    expect(emittedBuckets.at(-1)?.content).toBe('definitely not json');
    expect(fixture.nativeElement.querySelector('.data-bucket-editor__parse')?.textContent).toContain(
      'raw text',
    );
  });

  it('inserts a helper snippet at the caret and commits it', () => {
    const sourceBucket = createDataBucket('users');
    const { fixture, emittedBuckets } = buildFixture(sourceBucket);
    const contentTextarea = fixture.nativeElement.querySelector(
      '.data-bucket-editor__content-textarea',
    ) as HTMLTextAreaElement;
    contentTextarea.value = '{"name": ""}';
    // Index 10 sits between the two quotes of the empty string.
    contentTextarea.selectionStart = 10;
    contentTextarea.selectionEnd = 10;
    fixture.componentInstance.insertSnippetIntoContent('{{faker.person.fullName}}');
    expect(contentTextarea.value).toBe('{"name": "{{faker.person.fullName}}"}');
    expect(emittedBuckets.at(-1)?.content).toBe('{"name": "{{faker.person.fullName}}"}');
  });
});
