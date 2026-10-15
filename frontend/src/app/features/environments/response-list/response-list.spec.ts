import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ResponseList } from './response-list';
import { createRouteResponse } from '../../../core/defaults';
import { RouteResponse } from '../../../core/types';

describe('ResponseList', () => {
  function buildFixture(initialResponses: RouteResponse[] = []) {
    const emittedResponses: RouteResponse[][] = [];
    const fixture: ComponentFixture<ResponseList> = TestBed.createComponent(ResponseList);
    fixture.componentRef.setInput('responsesInput', initialResponses);
    // Controlled: echo emissions back into the input.
    fixture.componentInstance.responsesChange.subscribe((nextResponses) => {
      emittedResponses.push(nextResponses);
      fixture.componentRef.setInput('responsesInput', nextResponses);
    });
    fixture.detectChanges();
    return { fixture, emittedResponses };
  }

  function twoResponses(): [RouteResponse, RouteResponse] {
    const firstResponse = createRouteResponse('OK');
    firstResponse.defaultResponse = true;
    const secondResponse = createRouteResponse('Not found');
    secondResponse.defaultResponse = false;
    secondResponse.statusCode = 404;
    return [firstResponse, secondResponse];
  }

  it('renders rows with status, label and a rules badge when rules exist', () => {
    const [firstResponse, secondResponse] = twoResponses();
    firstResponse.rules = [{ uuid: 'r1', target: 'headers', property: 'x-api-key', modifier: '', operator: 'equals', invert: false, value: 'abc' }];
    const { fixture } = buildFixture([firstResponse, secondResponse]);
    expect(fixture.nativeElement.querySelectorAll('.response-list__row').length).toBe(2);
    expect(fixture.nativeElement.querySelector('.response-list__status--error')?.textContent).toContain('404');
    expect(fixture.nativeElement.querySelector('.response-list__rules-badge')?.textContent).toContain('1 rules');
  });

  it('adds a response that is NOT default when one already exists', () => {
    const [firstResponse] = twoResponses();
    const { fixture, emittedResponses } = buildFixture([firstResponse]);
    const addButton = fixture.nativeElement.querySelector('.response-list__add') as HTMLButtonElement;
    addButton.click();
    const nextResponses = emittedResponses.at(-1);
    expect(nextResponses?.length).toBe(2);
    const addedResponse = nextResponses?.[1];
    expect(addedResponse?.defaultResponse).toBe(false);
  });

  it('moves a response down and emits the reordered list', () => {
    const [firstResponse, secondResponse] = twoResponses();
    const { fixture, emittedResponses } = buildFixture([firstResponse, secondResponse]);
    const firstRowButtons = fixture.nativeElement.querySelectorAll('.response-list__row')[0].querySelectorAll('button');
    // Row buttons: up(0), down(1), duplicate(2), delete(3)
    (firstRowButtons[1] as HTMLButtonElement).click();
    const nextResponses = emittedResponses.at(-1);
    expect(nextResponses?.[0].uuid).toBe(secondResponse.uuid);
    expect(nextResponses?.[1].uuid).toBe(firstResponse.uuid);
  });

  it('duplicates a response with a fresh uuid and default=false', () => {
    const [firstResponse] = twoResponses();
    const { fixture, emittedResponses } = buildFixture([firstResponse]);
    const rowButtons = fixture.nativeElement.querySelectorAll('.response-list__row')[0].querySelectorAll('button');
    (rowButtons[2] as HTMLButtonElement).click();
    const nextResponses = emittedResponses.at(-1);
    expect(nextResponses?.length).toBe(2);
    const copiedResponse = nextResponses?.[1];
    expect(copiedResponse?.uuid).not.toBe(firstResponse.uuid);
    expect(copiedResponse?.defaultResponse).toBe(false);
    expect(copiedResponse?.label).toContain('(copy)');
  });

  it('deleting the default response auto-promotes the first remaining one', () => {
    const [firstResponse, secondResponse] = twoResponses();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { fixture, emittedResponses } = buildFixture([firstResponse, secondResponse]);
    const deleteButtons = fixture.nativeElement.querySelectorAll('.response-list__delete');
    (deleteButtons[0] as HTMLButtonElement).click();
    expect(confirmSpy).toHaveBeenCalled();
    const nextResponses = emittedResponses.at(-1);
    expect(nextResponses?.length).toBe(1);
    expect(nextResponses?.[0].uuid).toBe(secondResponse.uuid);
    expect(nextResponses?.[0].defaultResponse).toBe(true);
  });
});
