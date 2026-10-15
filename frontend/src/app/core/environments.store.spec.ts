import { TestBed } from '@angular/core/testing';
import { ApiError, MockApiClient } from './mock-api.client';
import { EnvironmentsStore } from './environments.store';
import { Environment } from './types';

/** A minimal valid environment for store tests. */
function testEnvironment(overrides: Partial<Environment> = {}): Environment {
  return {
    uuid: 'env-1',
    name: 'Test env',
    port: 3000,
    endpointPrefix: '',
    headers: [],
    proxyMode: false,
    proxyHost: '',
    proxyRemovePrefix: false,
    tlsOptions: { enabled: false, certPath: '', keyPath: '', passphrase: '' },
    routes: [],
    data: [],
    version: 3,
    ...overrides,
  };
}

describe('EnvironmentsStore', () => {
  function buildStore() {
    const apiClientFake = {
      listEnvironments: vi.fn().mockResolvedValue([
        { uuid: 'env-1', name: 'Test env', port: 3000, endpointPrefix: '', routeCount: 0, version: 3, listener: 'listening' },
      ]),
      getEnvironment: vi.fn().mockImplementation((environmentUuid: string) => Promise.resolve(testEnvironment())),
      createEnvironment: vi.fn().mockResolvedValue({ success: true, uuid: 'env-1', version: 1 }),
      saveEnvironment: vi.fn().mockImplementation((_uuid: string, expectedVersion: number) =>
        Promise.resolve({ success: true, version: expectedVersion + 1, needsListenerRestart: false }),
      ),
      deleteEnvironment: vi.fn().mockResolvedValue({ success: true }),
      duplicateEnvironment: vi.fn().mockResolvedValue({ success: true, version: 1 }),
      readLogs: vi.fn().mockResolvedValue([]),
      clearLogs: vi.fn().mockResolvedValue({ success: true }),
      serverStatus: vi.fn().mockResolvedValue({ ok: true, storage: 'file', environments: 1, listeners: [] }),
    };
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [{ provide: MockApiClient, useValue: apiClientFake }],
    });
    return { store: TestBed.inject(EnvironmentsStore), apiClientFake };
  }

  it('loads the list and selects the first environment', async () => {
    const { store, apiClientFake } = buildStore();
    await store.refreshList();
    expect(store.list().length).toBe(1);
    await store.selectEnvironment('env-1');
    expect(apiClientFake.getEnvironment).toHaveBeenCalledWith('env-1');
    expect(store.current()?.uuid).toBe('env-1');
    expect(store.savedVersion()).toBe(3);
    expect(store.selectedUuid()).toBe('env-1');
    expect(store.dirty()).toBe(false);
  });

  it('marks the store dirty when a mutation is applied', async () => {
    const { store } = buildStore();
    await store.selectEnvironment('env-1');
    expect(store.dirty()).toBe(false);
    store.update((draftEnvironment) => {
      draftEnvironment.name = 'Renamed';
    });
    expect(store.dirty()).toBe(true);
    expect(store.current()?.name).toBe('Renamed');
  });

  it('saves with the saved version and clears dirty on success', async () => {
    const { store, apiClientFake } = buildStore();
    await store.selectEnvironment('env-1');
    store.update((draftEnvironment) => {
      draftEnvironment.name = 'After edit';
    });
    const saveSucceeded = await store.saveCurrent();
    expect(saveSucceeded).toBe(true);
    expect(apiClientFake.saveEnvironment).toHaveBeenCalledWith('env-1', 3, expect.objectContaining({ name: 'After edit' }));
    expect(store.savedVersion()).toBe(4);
    expect(store.dirty()).toBe(false);
  });

  it('surfaces a 409 as conflictInfo and keeps dirty', async () => {
    const { store, apiClientFake } = buildStore();
    apiClientFake.saveEnvironment.mockRejectedValueOnce(
      new ApiError(409, 'Environment env-1 was modified (expected 3, found 5).', { message: 'expected 3, found 5', serverVersion: 5 }),
    );
    await store.selectEnvironment('env-1');
    store.update((draftEnvironment) => {
      draftEnvironment.name = 'Conflicting edit';
    });
    const saveSucceeded = await store.saveCurrent();
    expect(saveSucceeded).toBe(false);
    expect(store.conflictInfo()?.serverVersion).toBe(5);
    expect(store.dirty()).toBe(true);
    expect(store.savedVersion()).toBe(3); // unchanged
  });

  it('discard restores the saved snapshot', async () => {
    const { store } = buildStore();
    await store.selectEnvironment('env-1');
    store.update((draftEnvironment) => {
      draftEnvironment.name = 'Discarded';
    });
    expect(store.current()?.name).toBe('Discarded');
    await store.discardChanges();
    expect(store.current()?.name).toBe('Test env');
    expect(store.dirty()).toBe(false);
  });

  it('deleteEnvironment clears the selection when it was current', async () => {
    const { store } = buildStore();
    await store.selectEnvironment('env-1');
    await store.deleteEnvironment('env-1');
    expect(store.current()).toBeNull();
    expect(store.selectedUuid()).toBeNull();
    expect(store.dirty()).toBe(false);
  });

  it('createEnvironment creates then selects the new document', async () => {
    const { store, apiClientFake } = buildStore();
    await store.createEnvironment();
    expect(apiClientFake.createEnvironment).toHaveBeenCalled();
    expect(apiClientFake.getEnvironment).toHaveBeenCalledWith('env-1');
    expect(store.selectedUuid()).toBe('env-1');
  });
});
