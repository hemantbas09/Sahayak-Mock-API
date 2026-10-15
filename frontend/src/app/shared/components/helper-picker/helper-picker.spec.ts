import { TestBed } from '@angular/core/testing';
import { HelperPicker } from './helper-picker';

describe('HelperPicker', () => {
  function buildFixture() {
    const emittedSnippets: string[] = [];
    const fixture = TestBed.createComponent(HelperPicker);
    fixture.componentInstance.insertSnippet.subscribe((snippet) => emittedSnippets.push(snippet));
    fixture.detectChanges();
    return { fixture, emittedSnippets };
  }

  it('is closed by default and opens on toggle', () => {
    const { fixture } = buildFixture();
    expect(fixture.nativeElement.querySelector('.helper-picker__panel')).toBeNull();
    (fixture.nativeElement.querySelector('.helper-picker__toggle') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.helper-picker__panel')).toBeTruthy();
  });

  it('lists all helper groups', () => {
    const { fixture } = buildFixture();
    (fixture.nativeElement.querySelector('.helper-picker__toggle') as HTMLButtonElement).click();
    fixture.detectChanges();
    const groupLabels = fixture.nativeElement.querySelectorAll('.helper-picker__group-label') as NodeListOf<HTMLElement>;
    const labels = Array.from(groupLabels).map((labelElement) => labelElement.textContent?.trim());
    expect(labels).toContain('Request');
    expect(labels).toContain('Faker (random data)');
    expect(labels).toContain('Shortcuts');
  });

  it('filters entries by the search term', () => {
    const { fixture } = buildFixture();
    (fixture.nativeElement.querySelector('.helper-picker__toggle') as HTMLButtonElement).click();
    fixture.detectChanges();
    const searchInput = fixture.nativeElement.querySelector('.helper-picker__search') as HTMLInputElement;
    searchInput.value = 'uuid';
    searchInput.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    const snippets = Array.from(
      fixture.nativeElement.querySelectorAll('.helper-picker__snippet') as NodeListOf<HTMLElement>,
    ).map((snippetElement) => snippetElement.textContent?.trim());
    expect(snippets.length).toBeGreaterThan(0);
    expect(snippets.every((snippetText) => snippetText.toLowerCase().includes('uuid'))).toBe(true);
  });

  it('emits the chosen snippet and closes the panel', () => {
    const { fixture, emittedSnippets } = buildFixture();
    (fixture.nativeElement.querySelector('.helper-picker__toggle') as HTMLButtonElement).click();
    fixture.detectChanges();
    const firstEntry = fixture.nativeElement.querySelector('.helper-picker__entry') as HTMLButtonElement;
    firstEntry.dispatchEvent(new MouseEvent('mousedown'));
    fixture.detectChanges();
    expect(emittedSnippets.length).toBe(1);
    expect(emittedSnippets[0]).toContain('{{');
    expect(fixture.nativeElement.querySelector('.helper-picker__panel')).toBeNull();
  });
});
