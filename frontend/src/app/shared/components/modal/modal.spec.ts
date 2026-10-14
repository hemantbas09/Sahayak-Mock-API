import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Modal } from './modal';

/** Host component so project-content (ng-content) can be asserted. */
@Component({
  imports: [Modal],
  template: `<app-modal title="Settings test" (closed)="recordClose()"><span class="host-content">body</span></app-modal>`,
})
class ModalHost {
  closedCount = 0;

  recordClose(): void {
    this.closedCount++;
  }
}

describe('Modal', () => {
  function buildFixture() {
    const fixture = TestBed.createComponent(ModalHost);
    fixture.detectChanges();
    return fixture;
  }

  it('renders the title and projected body content', () => {
    const fixture = buildFixture();
    expect(fixture.nativeElement.querySelector('.modal__title')?.textContent).toContain('Settings test');
    expect(fixture.nativeElement.querySelector('.host-content')?.textContent).toContain('body');
  });

  it('emits closed when the × button is clicked', () => {
    const fixture = buildFixture();
    const closeButton = fixture.nativeElement.querySelector('.modal__close') as HTMLButtonElement;
    closeButton.click();
    expect(fixture.componentInstance.closedCount).toBe(1);
  });

  it('emits closed when Escape is pressed', () => {
    const fixture = buildFixture();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(fixture.componentInstance.closedCount).toBe(1);
  });

  it('emits closed when the backdrop is clicked, but not when the panel is', () => {
    const fixture = buildFixture();
    const panel = fixture.nativeElement.querySelector('.modal__panel') as HTMLElement;
    panel.click();
    expect(fixture.componentInstance.closedCount).toBe(0);
    const backdrop = fixture.nativeElement.querySelector('.modal') as HTMLElement;
    backdrop.click();
    expect(fixture.componentInstance.closedCount).toBe(1);
  });
});
