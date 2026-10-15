import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { AuthStore } from './auth.store';
import { MockApiClient } from './mock-api.client';

describe('AuthStore', () => {
  const fakeLoginResult = { token: 'jwt-token', user: { email: 'admin@example.com', role: 'admin' as const } };

  function buildStore(whoAmIResult: 'ok' | 'fail') {
    const apiClientFake = {
      login: vi.fn().mockResolvedValue(fakeLoginResult),
      whoAmI: vi
        .fn()
        .mockImplementation(() => (whoAmIResult === 'ok' ? Promise.resolve({ email: 'a@b.c', role: 'viewer' }) : Promise.reject(new Error('401')))),
    };
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: MockApiClient, useValue: apiClientFake },
        { provide: Router, useValue: { navigate: vi.fn() } },
      ],
    });
    return { store: TestBed.inject(AuthStore), apiClientFake };
  }

  it('starts unauthenticated with no stored token', () => {
    localStorage.clear();
    const { store } = buildStore('fail');
    expect(store.authenticated()).toBe(false);
    expect(store.user()).toBeNull();
    expect(store.token).toBeNull();
  });

  it('stores the token and user on login', async () => {
    localStorage.clear();
    const { store, apiClientFake } = buildStore('fail');
    await store.login('admin@example.com', 'admin1234');
    expect(apiClientFake.login).toHaveBeenCalledWith('admin@example.com', 'admin1234');
    expect(localStorage.getItem('sahayak.authToken')).toBe('jwt-token');
    expect(store.authenticated()).toBe(true);
    expect(store.user()?.email).toBe('admin@example.com');
    expect(store.role).toBe('admin');
  });

  it('clears the session on logout', async () => {
    localStorage.clear();
    const { store } = buildStore('fail');
    await store.login('admin@example.com', 'admin1234');
    store.logout();
    expect(store.authenticated()).toBe(false);
    expect(store.user()).toBeNull();
    expect(localStorage.getItem('sahayak.authToken')).toBeNull();
  });

  it('ranks roles: admin > editor > viewer', async () => {
    localStorage.clear();
    const { store } = buildStore('fail');
    await store.login('admin@example.com', 'admin1234');
    expect(store.hasRole('admin')).toBe(true);
    expect(store.hasRole('editor')).toBe(true);
    expect(store.hasRole('viewer')).toBe(true);
    expect(store.hasRole('admin') === true && store.hasRole('editor') === true).toBe(true);
  });

  it('restores a valid stored session on construction', async () => {
    localStorage.setItem('sahayak.authToken', 'stored-jwt');
    const { store } = buildStore('ok');
    await new Promise((resolveRestore) => setTimeout(resolveRestore, 0));
    expect(store.authenticated()).toBe(true);
    expect(store.user()?.email).toBe('a@b.c');
  });

  it('drops an invalid stored session', async () => {
    localStorage.setItem('sahayak.authToken', 'bad-jwt');
    const { store } = buildStore('fail');
    await new Promise((resolveRestore) => setTimeout(resolveRestore, 0));
    expect(store.authenticated()).toBe(false);
    expect(localStorage.getItem('sahayak.authToken')).toBeNull();
  });
});
