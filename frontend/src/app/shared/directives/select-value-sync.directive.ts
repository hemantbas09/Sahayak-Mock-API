import { AfterViewChecked, Directive, ElementRef, inject, input } from '@angular/core';

/**
 * `[value]` on a `<select>` whose options are rendered dynamically (via
 * `@for`) is applied before the options exist, and Angular does not
 * re-apply it afterwards — the control silently shows the first option.
 *
 * This directive re-syncs the native value once the wanted option exists
 * in the DOM, and keeps it in sync on later change-detection passes.
 * Usage: `<select [syncSelectValue]="someSignal()">…</select>`
 */
@Directive({
  selector: 'select[syncSelectValue]',
  standalone: true,
})
export class SelectValueSync implements AfterViewChecked {
  private readonly selectElementRef = inject<ElementRef<HTMLSelectElement>>(ElementRef);
  readonly syncSelectValue = input<string | number | null | undefined>('');

  ngAfterViewChecked(): void {
    const selectElement = this.selectElementRef.nativeElement;
    const rawValue = this.syncSelectValue();
    if (rawValue === null || rawValue === undefined) return;
    const desiredValue = String(rawValue);
    const wantedOption = selectElement.querySelector(`option[value="${desiredValue}"]`);
    if (wantedOption !== null && selectElement.value !== desiredValue) {
      selectElement.value = desiredValue;
    }
  }
}
