import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RouteList } from './route-list';
import { createHttpRoute } from '../../../core/defaults';
import { Route } from '../../../core/types';

describe('RouteList', () => {
  function buildFixture(initialRoutes: Route[] = []) {
    const emittedRoutes: Route[][] = [];
    const emittedSelections: string[] = [];
    const fixture: ComponentFixture<RouteList> = TestBed.createComponent(RouteList);
    fixture.componentRef.setInput('routesInput', initialRoutes);
    // Controlled component: echo every emission back into the input.
    fixture.componentInstance.routesChange.subscribe((nextRoutes) => {
      emittedRoutes.push(nextRoutes);
      fixture.componentRef.setInput('routesInput', nextRoutes);
    });
    fixture.componentInstance.selectChange.subscribe((routeUuid) => emittedSelections.push(routeUuid));
    fixture.detectChanges();
    return { fixture, emittedRoutes, emittedSelections };
  }

  it('renders one row per route with method badge and endpoint', () => {
    const getRoute = createHttpRoute('get', '/users');
    const postRoute = createHttpRoute('post', '/users');
    const { fixture } = buildFixture([getRoute, postRoute]);
    const rows = fixture.nativeElement.querySelectorAll('.route-list__row');
    expect(rows.length).toBe(2);
    const badges = fixture.nativeElement.querySelectorAll('.route-list__badge');
    expect(badges[0].textContent).toContain('GET');
    expect(badges[1].textContent).toContain('POST');
    expect(fixture.nativeElement.querySelector('.route-list__endpoint').textContent).toContain('/users');
  });

  it('adds an HTTP route, focuses it, and emits the extended list', () => {
    const { fixture, emittedRoutes, emittedSelections } = buildFixture([]);
    const addButtons = fixture.nativeElement.querySelectorAll('.route-list__add');
    (addButtons[0] as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('.route-list__row').length).toBe(1);
    const addedRoute = emittedRoutes.at(-1)?.[0];
    expect(addedRoute?.type).toBe('http');
    expect(addedRoute?.method).toBe('get');
    expect(emittedSelections).toEqual([addedRoute?.uuid]);
  });

  it('adds a CRUD route with a databucket response', () => {
    const { fixture, emittedRoutes } = buildFixture([]);
    const addButtons = fixture.nativeElement.querySelectorAll('.route-list__add');
    (addButtons[1] as HTMLButtonElement).click();
    const addedRoute = emittedRoutes.at(-1)?.[0];
    expect(addedRoute?.type).toBe('crud');
    expect(addedRoute?.responses[0]?.bodyType).toBe('DATABUCKET');
  });

  it('moves a route down and emits the reordered list', () => {
    const firstRoute = createHttpRoute('get', '/first');
    const secondRoute = createHttpRoute('get', '/second');
    const { fixture, emittedRoutes } = buildFixture([firstRoute, secondRoute]);
    const firstRowButtons = fixture.nativeElement.querySelectorAll('.route-list__row')[0]
      .querySelectorAll('button');
    // Order: badge(0), endpoint(1), up(2), down(3), duplicate(4), delete(5)
    (firstRowButtons[3] as HTMLButtonElement).click();
    const nextRoutes = emittedRoutes.at(-1);
    expect(nextRoutes?.[0].uuid).toBe(secondRoute.uuid);
    expect(nextRoutes?.[1].uuid).toBe(firstRoute.uuid);
  });

  it('changes the response mode to RANDOM', () => {
    const sourceRoute = createHttpRoute('get', '/mode');
    const { fixture, emittedRoutes } = buildFixture([sourceRoute]);
    const modeSelect = fixture.nativeElement.querySelector('.route-list__mode') as HTMLSelectElement;
    modeSelect.value = 'RANDOM';
    modeSelect.dispatchEvent(new Event('change'));
    expect(emittedRoutes.at(-1)?.[0]?.responseMode).toBe('RANDOM');
  });

  it('deletes a route after confirm', () => {
    const sourceRoute = createHttpRoute('get', '/bye');
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { fixture, emittedRoutes } = buildFixture([sourceRoute]);
    const deleteButton = fixture.nativeElement.querySelector('.route-list__delete') as HTMLButtonElement;
    deleteButton.click();
    fixture.detectChanges(); // echo the emission back into the DOM
    expect(confirmSpy).toHaveBeenCalled();
    expect(emittedRoutes.at(-1)).toEqual([]);
    expect(fixture.nativeElement.querySelectorAll('.route-list__row').length).toBe(0);
  });
});
