import { TestBed } from '@angular/core/testing';
import { RuleEditor } from './rule-editor';
import { RouteRule } from '../../../core/types';

describe('RuleEditor', () => {
  const sampleRule: RouteRule = {
    uuid: 'rule-1',
    target: 'query',
    property: 'tier',
    modifier: '',
    operator: 'equals',
    invert: false,
    value: 'gold',
  };

  function buildFixture(initialRules: RouteRule[] = []) {
    const emittedRules: RouteRule[][] = [];
    const emittedOperators: string[] = [];
    const fixture = TestBed.createComponent(RuleEditor);
    fixture.componentRef.setInput('rulesInput', initialRules);
    // The component is controlled: echo every emission back into the inputs,
    // exactly as the real parent (response-editor) does.
    fixture.componentInstance.rulesChange.subscribe((nextRules) => {
      emittedRules.push(nextRules);
      fixture.componentRef.setInput('rulesInput', nextRules);
    });
    fixture.componentInstance.operatorChange.subscribe((nextOperator) => {
      emittedOperators.push(nextOperator);
      fixture.componentRef.setInput('operatorInput', nextOperator);
    });
    fixture.detectChanges();
    return { fixture, emittedRules, emittedOperators };
  }

  it('renders one row per rule', () => {
    const { fixture } = buildFixture([sampleRule]);
    expect(fixture.nativeElement.querySelectorAll('.rule-editor__row').length).toBe(1);
  });

  it('adds a rule with the headers target default', () => {
    const { fixture, emittedRules } = buildFixture([]);
    (fixture.nativeElement.querySelector('.rule-editor__add') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('.rule-editor__row').length).toBe(1);
    const addedRule = emittedRules.at(-1)?.[0];
    expect(addedRule?.target).toBe('headers');
    expect(addedRule?.operator).toBe('equals');
    expect(addedRule?.invert).toBe(false);
  });

  it('changes the operator and disables the value for valueless operators', () => {
    const { fixture, emittedRules } = buildFixture([sampleRule]);
    const operatorSelect = fixture.nativeElement.querySelector('.rule-editor__operator') as HTMLSelectElement;
    operatorSelect.value = 'exists';
    operatorSelect.dispatchEvent(new Event('change'));
    expect(emittedRules.at(-1)?.[0]?.operator).toBe('exists');
    fixture.detectChanges();
    const valueInput = fixture.nativeElement.querySelector('.rule-editor__value') as HTMLInputElement;
    expect(valueInput.disabled).toBe(true);
  });

  it('toggles invert and removes the rule', () => {
    const { fixture, emittedRules } = buildFixture([sampleRule]);
    const invertCheckbox = fixture.nativeElement.querySelector('.rule-editor__invert-checkbox') as HTMLInputElement;
    invertCheckbox.checked = true;
    invertCheckbox.dispatchEvent(new Event('change'));
    expect(emittedRules.at(-1)?.[0]?.invert).toBe(true);

    (fixture.nativeElement.querySelector('.rule-editor__remove') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('.rule-editor__row').length).toBe(0);
    expect(emittedRules.at(-1)).toEqual([]);
  });

  it('emits the rules operator on toggle', () => {
    const { fixture, emittedOperators } = buildFixture([]);
    const operatorSelect = fixture.nativeElement.querySelector('.rule-editor__operator-toggle select') as HTMLSelectElement;
    operatorSelect.value = 'OR';
    operatorSelect.dispatchEvent(new Event('change'));
    expect(emittedOperators).toEqual(['OR']);
  });
});
