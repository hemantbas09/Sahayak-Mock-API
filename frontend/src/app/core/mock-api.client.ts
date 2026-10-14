/**
 * MockApiClient — typed wrapper over the configuration API (DESIGN §6).
 *
 * All calls carry the JWT via the auth interceptor (auth.interceptor.ts).
 * The store layer treats thrown ApiError as user-facing toasts; 409 on
 * PUT is surfaced as a structured ConflictInfo for the conflict banner.
 */
import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, firstValueFrom } from 'rxjs';
import {
  AuthUser,
  ConflictInfo,
  Environment,
  EnvironmentSummary,
  RequestLog,
  ServerStatus,
} from './types';

const API_BASE = '/api';

/** Error with the HTTP status so the UI can branch (401 → login, 409 → banner). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly conflict?: ConflictInfo,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Parse the server's `{ error, message?, serverVersion? }` body. */
function describeFailure(status: number, rawBody: unknown): { message: string; conflict?: ConflictInfo } {
  if (rawBody && typeof rawBody === 'object') {
    const body = rawBody as Record<string, unknown>;
    const serverMessage =
      typeof body['message'] === 'string' && body['message']
        ? body['message']
        : typeof body['error'] === 'string'
          ? body['error']
          : '';
    if (status === 409 && typeof body['serverVersion'] === 'number') {
      return {
        message: serverMessage || 'Version conflict — the environment was modified by someone else.',
        conflict: { message: serverMessage, serverVersion: body['serverVersion'] },
      };
    }
    if (serverMessage) return { message: serverMessage };
  }
  return { message: `Request failed (HTTP ${status})` };
}

@Injectable({ providedIn: 'root' })
export class MockApiClient {
  private readonly httpClient = inject(HttpClient);

  private async call<T>(request$: Observable<unknown>): Promise<T> {
    try {
      const rawBody = await firstValueFrom(request$);
      return rawBody as T;
    } catch (caught) {
      const errorObject = caught as { status?: unknown; error?: unknown } | null;
      const status = typeof errorObject?.status === 'number' ? errorObject.status : 0;
      const { message, conflict } = describeFailure(status, errorObject?.error);
      throw new ApiError(status, message, conflict);
    }
  }

  // --- auth -------------------------------------------------------------

  login(email: string, password: string): Promise<{ token: string; user: AuthUser }> {
    return this.call(this.httpClient.post(`${API_BASE}/auth/login`, { email, password }));
  }

  whoAmI(): Promise<AuthUser> {
    return this.call(this.httpClient.get(`${API_BASE}/auth/me`));
  }

  // --- environments -------------------------------------------------------

  listEnvironments(): Promise<EnvironmentSummary[]> {
    return this.call(this.httpClient.get(`${API_BASE}/environments`));
  }

  getEnvironment(environmentUuid: string): Promise<Environment> {
    return this.call(this.httpClient.get(`${API_BASE}/environments/${environmentUuid}`));
  }

  createEnvironment(environment: Environment): Promise<{ success: boolean; uuid: string; version: number }> {
    return this.call(this.httpClient.post(`${API_BASE}/environments`, environment));
  }

  /** Whole-document save with optimistic concurrency (409 → ConflictInfo). */
  saveEnvironment(environmentUuid: string, expectedVersion: number, environment: Environment): Promise<{ success: boolean; version: number; needsListenerRestart: boolean }> {
    return this.call(this.httpClient.put(`${API_BASE}/environments/${environmentUuid}`, { version: expectedVersion, environment }));
  }

  deleteEnvironment(environmentUuid: string): Promise<{ success: boolean }> {
    return this.call(this.httpClient.delete(`${API_BASE}/environments/${environmentUuid}`));
  }

  duplicateEnvironment(environmentUuid: string): Promise<{ success: boolean; version: number }> {
    return this.call(this.httpClient.post(`${API_BASE}/environments/${environmentUuid}/duplicate`, {}));
  }

  startEnvironment(environmentUuid: string): Promise<{ success: boolean; status?: unknown }> {
    return this.call(this.httpClient.post(`${API_BASE}/environments/${environmentUuid}/start`, {}));
  }

  stopEnvironment(environmentUuid: string): Promise<{ success: boolean; status?: unknown }> {
    return this.call(this.httpClient.post(`${API_BASE}/environments/${environmentUuid}/stop`, {}));
  }

  // --- import / export ----------------------------------------------------

  /** Upload a Mockoon JSON or OpenAPI v3 file (multipart, field "file"). */
  importFile(uploadFile: File): Promise<{ success: boolean; imported: { uuid: string; name: string; portConflict: boolean }[] }> {
    const formPayload = new FormData();
    formPayload.append('file', uploadFile);
    return this.call(this.httpClient.post(`${API_BASE}/import`, formPayload));
  }

  /** Mockoon JSON download (DESIGN §2.13 round-trip). */
  exportEnvironment(environmentUuid: string): Promise<Blob> {
    return this.call(this.httpClient.get(`${API_BASE}/environments/${environmentUuid}/export`, {
      responseType: 'blob',
      headers: new HttpHeaders({ Accept: 'application/json' }),
    }));
  }

  // --- preview / logs / status -------------------------------------------

  previewTemplate(environmentUuid: string, template: string): Promise<{ output: string; warnings: string[] }> {
    return this.call(this.httpClient.post(`${API_BASE}/environments/${environmentUuid}/preview-template`, { template }));
  }

  readLogs(query?: { envUuid?: string; limit?: number }): Promise<RequestLog[]> {
    let queryParams = new HttpParams();
    if (query?.envUuid) queryParams = queryParams.set('env', query.envUuid);
    if (query?.limit) queryParams = queryParams.set('limit', String(query.limit));
    return this.call(this.httpClient.get(`${API_BASE}/logs`, { params: queryParams }));
  }

  clearLogs(): Promise<{ success: boolean }> {
    return this.call(this.httpClient.delete(`${API_BASE}/logs`));
  }

  serverStatus(): Promise<ServerStatus> {
    return this.call(this.httpClient.get(`${API_BASE}/status`));
  }
}
