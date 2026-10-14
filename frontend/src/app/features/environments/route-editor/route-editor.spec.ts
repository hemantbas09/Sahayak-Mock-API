import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RouteEditor } from './route-editor';
import { createHttpRoute } from '../../../core/defaults';
import { Route } from '../../../core/types';

describe('RouteEditor', () => {
  function buildFixture(initialRoute: Route | null) {
    const emittedRoutes: Route[] = [];
    const fixture: ComponentFixture<RouteEditor> = TestBed.createComponent(RouteEditor);
    fixture.componentRef.setInput('routeInput', initialRoute);
    // Controlled: echo back the emitted clone.
    fixture.componentInstance.routeChange.subscribe((nextRoute) => {
      emittedRoutes.push(nextRoute);
      fixture.componentRef.setInput('routeInput', nextRoute);
    });
    fixture.detectChanges();
    return { fixture, emittedRoutes };
  }

  it('renders endpoint, method select and documentation for an HTTP route', () => {
    const httpRoute = createHttpRoute('post', '/users');
    const { fixture } = buildFixture(httpRoute);
    const endpointInput = fixture.nativeElement.querySelector('.route-editor__endpoint-input') as HTMLInputElement;
    expect(endpointInput.value).toBe('/users');
    const methodSelect = fixture.nativeElement.querySelector('.route-editor__method') as HTMLSelectElement;
    expect(methodSelect.value).toBe('post');
    expect(fixture.nativeElement.querySelector('.route-editor__docs')).not.toBeNull();
  });

  it('emits the route with a changed endpoint, keeping the uuid', () => {
    const httpRoute = createHttpRoute('get', '/old');
    const { fixture, emittedRoutes } = buildFixture(httpRoute);
    const endpointInput = fixture.nativeElement.querySelector('.route-editor__endpoint-input') as HTMLInputElement;
    endpointInput.value = '/new';
    endpointInput.dispatchEvent(new Event('change'));
    expect(emittedRoutes.at(-1)?.endpoint).toBe('/new');
    expect(emittedRoutes.at(-1)?.uuid).toBe(httpRoute.uuid);
  });

  it('emits the route with a changed method', () => {
    const httpRoute = createHttpRoute('get', '/flip');
    const { fixture, emittedRoutes } = buildFixture(httpRoute);
    const methodSelect = fixture.nativeElement.querySelector('.route-editor__method') as HTMLSelectElement;
    methodSelect.value = 'delete';
    methodSelect.dispatchEvent(new Event('change'));
    expect(emittedRoutes.at(-1)?.method).toBe('delete');
  });
});
