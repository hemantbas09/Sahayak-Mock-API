import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RouteEditor } from './route-editor';
import { createCrudRoute, createDataBucket, createHttpRoute } from '../../../core/defaults';
import { Route } from '../../../core/types';

describe('RouteEditor', () => {
  function buildFixture(initialRoute: Route | null, bucketNames: string[] = []) {
    const emittedRoutes: Route[] = [];
    const fixture: ComponentFixture<RouteEditor> = TestBed.createComponent(RouteEditor);
    fixture.componentRef.setInput('routeInput', initialRoute);
    if (bucketNames.length > 0) {
      fixture.componentRef.setInput('bucketsInput', bucketNames.map((bucketName) => createDataBucket(bucketName)));
    }
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

  it('shows the bucket selector instead of the method for CRUD routes', () => {
    const crudRoute = createCrudRoute('/items');
    const { fixture } = buildFixture(crudRoute, ['orders', 'users']);
    expect(fixture.nativeElement.querySelector('.route-editor__method')).toBeNull();
    const bucketSelect = fixture.nativeElement.querySelector('.route-editor__bucket') as HTMLSelectElement;
    expect(bucketSelect).not.toBeNull();
    // The select is keyed by bucket uuid, displays the name.
    const chosenOption = [...bucketSelect.options].find((option) => option.textContent === 'users');
    expect(chosenOption).toBeDefined();
    const chosenBucketUuid = chosenOption?.value ?? '';
    expect(chosenBucketUuid).not.toBe('');
    bucketSelect.value = chosenBucketUuid;
    bucketSelect.dispatchEvent(new Event('change'));
    // The fixture echoes emissions back into the input, so read it back from there.
    const echoedRoute = fixture.componentInstance.routeInput();
    expect(echoedRoute?.responses[0]?.databucketId).toBe(chosenBucketUuid);
  });
});
