import { TestBed } from '@angular/core/testing';
import { KvList } from './kv-list';
import { KeyValue } from '../../../core/types';

describe('KvList', () => {
  function buildFixture(initialItems: KeyValue[] = []) {
    const emittedItems: KeyValue[][] = [];
    const fixture = TestBed.createComponent(KvList);
    fixture.componentRef.setInput('itemsInput', initialItems);
    // The component is controlled: echo every emission back into the input,
    // exactly as the real parents (env-settings, response-editor) do.
    fixture.componentInstance.itemsChange.subscribe((nextItems) => {
      emittedItems.push(nextItems);
      fixture.componentRef.setInput('itemsInput', nextItems);
    });
    fixture.detectChanges();
    return { fixture, emittedItems };
  }

  it('renders the initial rows', () => {
    const { fixture } = buildFixture([
      { key: 'Content-Type', value: 'application/json' },
      { key: 'X-Extra', value: '1' },
    ]);
    const rows = fixture.nativeElement.querySelectorAll('.kv-list__row');
    expect(rows.length).toBe(2);
    const keyInputs = fixture.nativeElement.querySelectorAll('.kv-list__key') as NodeListOf<HTMLInputElement>;
    expect(keyInputs[0].value).toBe('Content-Type');
  });

  it('adds a row and emits the updated list', () => {
    const { fixture, emittedItems } = buildFixture([]);
    (fixture.nativeElement.querySelector('.kv-list__add') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('.kv-list__row').length).toBe(1);
    expect(emittedItems.length).toBe(1);
    expect(emittedItems[0]).toEqual([{ key: '', value: '' }]);
  });

  it('edits a row value on change', () => {
    const { fixture, emittedItems } = buildFixture([{ key: 'A', value: '1' }]);
    const valueInput = fixture.nativeElement.querySelector('.kv-list__value') as HTMLInputElement;
    valueInput.value = 'changed';
    valueInput.dispatchEvent(new Event('change'));
    expect(emittedItems.at(-1)).toEqual([{ key: 'A', value: 'changed' }]);
  });

  it('removes a row', () => {
    const { fixture, emittedItems } = buildFixture([
      { key: 'A', value: '1' },
      { key: 'B', value: '2' },
    ]);
    const removeButtons = fixture.nativeElement.querySelectorAll('.kv-list__remove');
    (removeButtons[0] as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('.kv-list__row').length).toBe(1);
    expect(emittedItems.at(-1)).toEqual([{ key: 'B', value: '2' }]);
  });
});
