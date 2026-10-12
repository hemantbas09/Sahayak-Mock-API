/**
 * Tiny client for the server's REST API.
 *
 * Saving sends operations only - the exact entities that changed - and
 * receives a synchronous acknowledgement once the batch has been applied.
 */
import { MockEnvironment, RequestLog } from './types';
import { OpsPayload } from './ops';

const BASE = '/api';

async function parseError(res: Response): Promise<string> {
  try {
    const text = await res.text();
    try {
      const parsed = JSON.parse(text);
      return [parsed.error, parsed.details, parsed.hint].filter(Boolean).join(' | ') || `HTTP ${res.status}`;
    } catch {
      return text || `HTTP ${res.status}`;
    }
  } catch {
    return `HTTP ${res.status}`;
  }
}

export async function fetchEnvironments(): Promise<MockEnvironment[]> {
  const res = await fetch(`${BASE}/environments`);
  if (!res.ok) throw new Error(await parseError(res));
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

export async function fetchLogs(): Promise<RequestLog[]> {
  const res = await fetch(`${BASE}/logs`);
  if (!res.ok) throw new Error(await parseError(res));
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

export async function clearLogs(): Promise<void> {
  const res = await fetch(`${BASE}/logs`, { method: 'DELETE' });
  if (!res.ok) throw new Error(await parseError(res));
}

/**
 * Persist a batch of operations (only the changed entities).
 * Resolves with the number of applied ops; throws with a readable message
 * when the server rejects the batch.
 */
export async function saveOps(payload: OpsPayload): Promise<number> {
  const res = await fetch(`${BASE}/environments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw new Error(await parseError(res));
  }

  const data = await res.json().catch(() => ({}));
  return typeof data.applied === 'number' ? data.applied : 0;
}
