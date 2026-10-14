import { Component, input, output } from '@angular/core';
import { RULE_OPERATOR_OPTIONS, RULE_TARGET_OPTIONS, VALUELESS_OPERATORS } from '../../../core/rule-options';
import { DataBucket, RouteRule, RulesOperator } from '../../../core/types';
import { newUuid } from '../../../core/utils';
import { SelectValueSync } from '../../directives/select-value-sync.directive';

/**
 * F4 — conditional-response rule editor. Block: .rule-editor
 *
 * Controlled component: renders `rulesInput` (+ AND/OR toggle from
 * `operatorInput`) and emits the next full rule list / operator on every
 * mutation. Parent binds:
 *   [rulesInput]="rules" (rulesChange)="onRules($event)"
 *   [operatorInput]="rulesOperator" (operatorChange)="onOperator($event)"
 */
@Component({
  selector: 'app-rule-editor',
  imports: [SelectValueSync],
  template: `
    <div class="rule-editor">
      @for (ruleRow of rulesInput(); track ruleRow.uuid) {
        <div class="rule-editor__row">
          <select
            class="rule-editor__target"
            [value]="ruleRow.target"
            [syncSelectValue]="ruleRow.target"
            (change)="setField(ruleRow, 'target', $event)"
            aria-label="Rule target"
          >
            @for (targetOption of targetOptions; track targetOption.id) {
              <option [value]="targetOption.id">{{ targetOption.label }}</option>
            }
          </select>

          @if (ruleRow.target === 'data_bucket') {
            <select
              class="rule-editor__property"
              [value]="ruleRow.property"
              [syncSelectValue]="ruleRow.property"
              (change)="setField(ruleRow, 'property', $event)"
              aria-label="Bucket name"
            >
              <option value="" disabled>Select bucket…</option>
              @for (bucket of bucketsInput(); track bucket.uuid) {
                <!-- Engine resolves the bucket by uuid (runtime map key). -->
                <option [value]="bucket.uuid">{{ bucket.name }}</option>
              }
            </select>
            <input
              class="rule-editor__modifier"
              type="text"
              placeholder="path in bucket (optional)"
              [value]="ruleRow.modifier"
              (change)="setField(ruleRow, 'modifier', $event)"
            />
          } @else {
            <input
              class="rule-editor__property"
              type="text"
              placeholder="{{ propertyPlaceholder(ruleRow.target) }}"
              [value]="ruleRow.property"
              (change)="setField(ruleRow, 'property', $event)"
            />
          }

          <select
            class="rule-editor__operator"
            [value]="ruleRow.operator"
            [syncSelectValue]="ruleRow.operator"
            (change)="setField(ruleRow, 'operator', $event)"
            aria-label="Operator"
          >
            @for (operatorOption of operatorOptions; track operatorOption.id) {
              <option [value]="operatorOption.id">{{ operatorOption.label }}</option>
            }
          </select>

          <input
            class="rule-editor__value"
            type="text"
            placeholder="{{ valueless(ruleRow.operator) ? '—' : 'Expected value (templating ok)' }}"
            [value]="ruleRow.value"
            [disabled]="valueless(ruleRow.operator)"
            (change)="setField(ruleRow, 'value', $event)"
          />

          <label class="rule-editor__invert">
            <input
              class="rule-editor__invert-checkbox"
              type="checkbox"
              [checked]="ruleRow.invert"
              (change)="setField(ruleRow, 'invert', $event)"
            />
            <span>invert</span>
          </label>

          <button class="rule-editor__remove" type="button" title="Remove rule" (click)="removeRule(ruleRow.uuid)">×</button>
        </div>
      } @empty {
        <p class="rule-editor__empty">No rules — without rules, only the default response can match.</p>
      }

      <div class="rule-editor__footer">
        <button class="rule-editor__add" type="button" (click)="addRule()">+ Add rule</button>
        <label class="rule-editor__operator-toggle">
          Match rules with
          <select [value]="operatorInput()" (change)="operatorSelected($event)" aria-label="Rules operator">
            <option value="AND">ALL (AND)</option>
            <option value="OR">ANY (OR)</option>
          </select>
        </label>
      </div>
    </div>
  `,
  styleUrl: './rule-editor.scss',
})
export class RuleEditor {
  readonly rulesInput = input<RouteRule[]>([]);
  readonly operatorInput = input<RulesOperator>('AND');
  readonly bucketsInput = input<DataBucket[]>([]);
  readonly rulesChange = output<RouteRule[]>();
  readonly operatorChange = output<RulesOperator>();

  readonly targetOptions = RULE_TARGET_OPTIONS;
  readonly operatorOptions = RULE_OPERATOR_OPTIONS;

  /** Operators that never take an expected value. */
  valueless(operatorId: string): boolean {
    return VALUELESS_OPERATORS.has(operatorId);
  }

  propertyPlaceholder(target: string): string {
    const placeholderHints: Record<string, string> = {
      body: 'path in body (JSONPath ok)',
      query: 'param name',
      params: ':param name',
      headers: 'header name',
      cookie: 'cookie name',
      global_var: 'variable name',
      request_number: '',
      data_bucket: '',
    };
    return placeholderHints[target] ?? 'property name';
  }

  addRule(): void {
    this.rulesChange.emit([
      ...this.rulesInput(),
      { uuid: newUuid(), target: 'headers', property: '', modifier: '', operator: 'equals', invert: false, value: '' },
    ]);
  }

  removeRule(ruleUuid: string): void {
    this.rulesChange.emit(this.rulesInput().filter((ruleRow) => ruleRow.uuid !== ruleUuid));
  }

  setField(ruleRow: RouteRule, field: 'target' | 'property' | 'modifier' | 'operator' | 'value' | 'invert', changeEvent: Event): void {
    const targetElement = changeEvent.target as HTMLInputElement | HTMLSelectElement;
    const rawValue =
      field === 'invert' ? (targetElement as HTMLInputElement).checked : (targetElement as HTMLInputElement | HTMLSelectElement).value;
    this.rulesChange.emit(
      this.rulesInput().map((existingRule) =>
        existingRule.uuid === ruleRow.uuid ? { ...existingRule, [field]: rawValue } : existingRule,
      ),
    );
  }

  operatorSelected(changeEvent: Event): void {
    const nextOperator = (changeEvent.target as HTMLSelectElement).value;
    if (nextOperator === 'AND' || nextOperator === 'OR') this.operatorChange.emit(nextOperator);
  }
}
