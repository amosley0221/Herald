import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { randomId, type HeraldBackend } from '@herald/core';

/**
 * Answering a phone that has paired with this machine.
 *
 * Rust listens on the network; every request it receives is handed here, and
 * answered by the same `LocalBackend` the desktop window uses. So the phone
 * sees a Herald engine, and there is still only one implementation of what a
 * match is and how it was scored.
 *
 * The alternative — replicating between two independent databases — would mean
 * deciding what happens when both devices approve the same match offline. One
 * source of truth has no such question.
 */

interface BridgeRequest {
  id: string;
  method: string;
  path: string;
  query: string;
  body: string;
}

export interface PairingInfo {
  baseUrl: string;
  token: string;
  port: number;
}

/** Generated once and kept, so a phone paired yesterday still works today. */
const TOKEN_KEY = 'herald.pairingToken';

export function pairingToken(): string {
  const existing = localStorage.getItem(TOKEN_KEY);
  if (existing) return existing;
  const token = `${randomId()}${randomId()}`.replace(/-/g, '');
  localStorage.setItem(TOKEN_KEY, token);
  return token;
}

export async function startPairing(backend: HeraldBackend, port = 8787): Promise<PairingInfo> {
  return invoke<PairingInfo>('start_pairing', { port, token: pairingToken() });
}

export async function stopPairing(): Promise<void> {
  await invoke('stop_pairing');
}

export async function pairingStatus(): Promise<PairingInfo | null> {
  return (await invoke<PairingInfo | null>('pairing_status')) ?? null;
}

/**
 * Starts answering forwarded requests.
 *
 * Returns the unlisten function; the caller stops answering by calling it.
 */
export async function serveRequests(backend: HeraldBackend): Promise<UnlistenFn> {
  return listen<BridgeRequest>('herald://pairing-request', (event) => {
    void answer(backend, event.payload);
  });
}

async function answer(backend: HeraldBackend, request: BridgeRequest): Promise<void> {
  let status = 200;
  let body = 'null';

  try {
    const result = await route(backend, request);
    body = JSON.stringify(result ?? null);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    // A phone asking for a match that has been skipped is a 404, not a fault
    // worth a 500; anything else is genuinely this machine's problem.
    status = /no longer available|not been uploaded/i.test(message) ? 404 : 500;
    body = JSON.stringify({ code: status === 404 ? 'not_found' : 'error', message });
  }

  await invoke('pairing_reply', { reply: { id: request.id, status, body } });
}

/**
 * Maps a request onto the backend.
 *
 * Deliberately the same paths the Node engine serves, because the phone was
 * written against those and neither side should have to care which kind of
 * engine answered.
 */
async function route(backend: HeraldBackend, request: BridgeRequest): Promise<unknown> {
  const { method, path } = request;
  const params = new URLSearchParams(request.query);
  const payload = request.body ? (JSON.parse(request.body) as Record<string, unknown>) : {};

  const match = (pattern: RegExp): string | null => pattern.exec(path)?.[1] ?? null;

  if (method === 'GET' && path === '/health') {
    return { ok: true, version: 'desktop' };
  }
  if (method === 'GET' && path === '/status') {
    return { ok: true, scanning: false };
  }
  if (method === 'GET' && path === '/stats/today') return backend.todayStats();
  if (method === 'GET' && path === '/preferences') return backend.getPreferences();
  if (method === 'PUT' && path === '/preferences') return backend.updatePreferences(payload);
  if (method === 'GET' && path === '/profile') return backend.getProfile();
  if (method === 'PUT' && path === '/profile') return backend.updateProfile(payload);
  if (method === 'GET' && path === '/releases') return backend.releases();
  if (method === 'POST' && path === '/crawl') return backend.runCrawl();

  if (method === 'GET' && path === '/matches') {
    const status = params.getAll('status');
    return backend.listMatches({
      ...(status.length ? { status: status as never } : {}),
      ...(params.get('limit') ? { limit: Number(params.get('limit')) } : {}),
      ...(params.get('since') ? { since: params.get('since') as string } : {}),
    });
  }

  const approve = match(/^\/matches\/([^/]+)\/approve$/);
  if (method === 'POST' && approve) return backend.approve(decodeURIComponent(approve));

  const submit = match(/^\/matches\/([^/]+)\/submit$/);
  if (method === 'POST' && submit) {
    return backend.submit(
      decodeURIComponent(submit),
      payload.fields as Record<string, string> | undefined,
      payload.coverLetter as string | undefined,
    );
  }

  const skip = match(/^\/matches\/([^/]+)\/skip$/);
  if (method === 'POST' && skip) return backend.skip(decodeURIComponent(skip));

  const log = match(/^\/matches\/([^/]+)\/log$/);
  if (method === 'GET' && log) return backend.log(decodeURIComponent(log));

  const one = match(/^\/matches\/([^/]+)$/);
  if (method === 'GET' && one) return backend.getMatch(decodeURIComponent(one));

  // Device registration is a push concept and this engine cannot push, so it is
  // accepted and ignored rather than failing a phone that politely offers one.
  if (path === '/devices' || path.startsWith('/devices/')) return { ok: true };

  throw new Error(`No route for ${method} ${path}`);
}
