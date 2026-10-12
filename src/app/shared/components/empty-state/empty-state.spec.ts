import { TestBed } from '@angular/core/testing';
import { EmptyState } from './empty-state';

describe('EmptyState', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [EmptyState],
    }).compileComponents();
  });

  it('renders the title', async () => {
    const fixture = TestBed.createComponent(EmptyState);
    fixture.componentRef.setInput('titleInput', 'No environments');
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.empty-state__title')?.textContent).toContain(
      'No environments'
    );
  });

  it('hides the hint when empty', async () => {
    const fixture = TestBed.createComponent(EmptyState);
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.empty-state__hint')).toBeNull();
  });
});
