import { TestBed } from '@angular/core/testing';
import { Spinner } from './spinner';

describe('Spinner', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Spinner],
    }).compileComponents();
  });

  it('renders the ring', async () => {
    const fixture = TestBed.createComponent(Spinner);
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.spinner__ring')).toBeTruthy();
  });

  it('renders the label when provided', async () => {
    const fixture = TestBed.createComponent(Spinner);
    fixture.componentRef.setInput('labelInput', 'Loading');
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.spinner__label')?.textContent).toContain('Loading');
  });
});
