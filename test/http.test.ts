import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthContext } from '../src/types';
import { BASE_URL, DEFAULT_VERSION, GhlApiError } from '../src/types';

const auth: AuthContext = { apiKey: 'test-api-key', locationId: 'loc-123' };

function _mockFetch(responses: Array<Response | (() => Promise<Response>)>) {
  let callCount = 0;
  vi.stubGlobal('fetch', async (..._args: unknown[]) => {
    const res = responses[callCount];
    callCount++;
    if (typeof res === 'function') return await res();
    return res;
  });
  return () => callCount;
}

function makeResponse(status: number, body: unknown, headers?: Record<string, string>): Response {
  const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
  const defaultHeaders: Record<string, string> = {
    'content-type': typeof body === 'string' ? 'text/plain' : 'application/json',
    ...headers,
  };
  return new Response(bodyStr, { status, headers: defaultHeaders });
}

describe('http', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('builds correct URL with no query params', async () => {
    const { ghlRequest } = await import('../src/http');
    let capturedUrl = '';
    vi.stubGlobal('fetch', async (url: string) => {
      capturedUrl = url;
      return makeResponse(200, { ok: true });
    });
    await ghlRequest(auth, { method: 'get', path: '/contacts/abc' });
    expect(capturedUrl).toBe(`${BASE_URL}/contacts/abc`);
  });

  it('builds URL with query params (arrays as repeated keys)', async () => {
    const { ghlRequest } = await import('../src/http');
    let capturedUrl = '';
    vi.stubGlobal('fetch', async (url: string) => {
      capturedUrl = url;
      return makeResponse(200, { ok: true });
    });
    await ghlRequest(auth, {
      method: 'get',
      path: '/contacts',
      query: { locationId: 'loc-1', tags: ['tag1', 'tag2'], limit: 20, active: true },
    });
    expect(capturedUrl).toContain('locationId=loc-1');
    expect(capturedUrl).toContain('tags=tag1');
    expect(capturedUrl).toContain('tags=tag2');
    expect(capturedUrl).toContain('limit=20');
    expect(capturedUrl).toContain('active=true');
  });

  it('drops undefined and null query values', async () => {
    const { ghlRequest } = await import('../src/http');
    let capturedUrl = '';
    vi.stubGlobal('fetch', async (url: string) => {
      capturedUrl = url;
      return makeResponse(200, {});
    });
    await ghlRequest(auth, {
      method: 'get',
      path: '/contacts',
      query: { present: 'yes', absent: undefined, alsoAbsent: null },
    });
    expect(capturedUrl).toContain('present=yes');
    expect(capturedUrl).not.toContain('absent');
    expect(capturedUrl).not.toContain('alsoAbsent');
  });

  it('sets correct request headers', async () => {
    const { ghlRequest } = await import('../src/http');
    let capturedHeaders: Record<string, string> = {};
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      capturedHeaders = Object.fromEntries(Object.entries(init.headers as Record<string, string>));
      return makeResponse(200, { data: 'ok' });
    });
    await ghlRequest(auth, { method: 'get', path: '/contacts' });
    expect(capturedHeaders.Authorization).toBe(`Bearer ${auth.apiKey}`);
    expect(capturedHeaders.Version).toBe(DEFAULT_VERSION);
    expect(capturedHeaders.Accept).toBe('application/json');
  });

  it('uses custom version header when provided', async () => {
    const { ghlRequest } = await import('../src/http');
    let capturedHeaders: Record<string, string> = {};
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      capturedHeaders = Object.fromEntries(Object.entries(init.headers as Record<string, string>));
      return makeResponse(200, {});
    });
    await ghlRequest(auth, { method: 'get', path: '/something', version: '2021-04-15' });
    expect(capturedHeaders.Version).toBe('2021-04-15');
  });

  it('sends Content-Type for POST with body', async () => {
    const { ghlRequest } = await import('../src/http');
    let capturedHeaders: Record<string, string> = {};
    let capturedBody: string | null = null;
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      capturedHeaders = Object.fromEntries(Object.entries(init.headers as Record<string, string>));
      capturedBody = init.body as string;
      return makeResponse(201, { id: 'new-id' });
    });
    await ghlRequest(auth, {
      method: 'post',
      path: '/contacts',
      body: { name: 'Test', email: 'test@example.com' },
    });
    expect(capturedHeaders['Content-Type']).toBe('application/json');
    expect(JSON.parse(capturedBody ?? '{}')).toEqual({ name: 'Test', email: 'test@example.com' });
  });

  it('does not send body for GET requests', async () => {
    const { ghlRequest } = await import('../src/http');
    let capturedInit: RequestInit = {};
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      capturedInit = init;
      return makeResponse(200, {});
    });
    await ghlRequest(auth, { method: 'get', path: '/contacts', body: { forbidden: true } });
    expect(capturedInit.body).toBeUndefined();
  });

  it('returns { ok: true } for 204 responses', async () => {
    const { ghlRequest } = await import('../src/http');
    vi.stubGlobal('fetch', async () => new Response(null, { status: 204 }));
    const result = await ghlRequest(auth, { method: 'delete', path: '/contacts/abc' });
    expect(result).toEqual({ ok: true });
  });

  it('returns { ok: true } for empty body 2xx', async () => {
    const { ghlRequest } = await import('../src/http');
    vi.stubGlobal('fetch', async () => new Response('', { status: 200 }));
    const result = await ghlRequest(auth, { method: 'get', path: '/contacts' });
    expect(result).toEqual({ ok: true });
  });

  it('throws GhlApiError on 4xx with parsed JSON body', async () => {
    const { ghlRequest } = await import('../src/http');
    vi.stubGlobal('fetch', async () =>
      makeResponse(404, { message: 'Not Found', code: 'CONTACT_NOT_FOUND' }),
    );
    await expect(
      ghlRequest(auth, { method: 'get', path: '/contacts/bad', retries: 0 }),
    ).rejects.toThrow(GhlApiError);
    try {
      await ghlRequest(auth, { method: 'get', path: '/contacts/bad', retries: 0 });
    } catch (e) {
      expect(e).toBeInstanceOf(GhlApiError);
      const err = e as GhlApiError;
      expect(err.status).toBe(404);
      expect(err.method).toBe('GET');
      expect(err.body).toMatchObject({ message: 'Not Found' });
    }
  });

  it('retries on 429 then succeeds', async () => {
    const { ghlRequest } = await import('../src/http');
    let callCount = 0;
    vi.stubGlobal('fetch', async () => {
      callCount++;
      if (callCount === 1) return makeResponse(429, { message: 'Too Many Requests' });
      return makeResponse(200, { data: 'success' });
    });
    const result = await ghlRequest(auth, {
      method: 'get',
      path: '/contacts',
      retries: 1,
      timeoutMs: 5000,
    });
    expect(callCount).toBe(2);
    expect(result).toMatchObject({ data: 'success' });
  });

  it('retries on 500 then succeeds', async () => {
    const { ghlRequest } = await import('../src/http');
    let callCount = 0;
    vi.stubGlobal('fetch', async () => {
      callCount++;
      if (callCount === 1) return makeResponse(500, { error: 'Internal Server Error' });
      return makeResponse(200, { id: 'abc' });
    });
    const result = await ghlRequest(auth, {
      method: 'post',
      path: '/contacts',
      body: {},
      retries: 1,
      timeoutMs: 5000,
    });
    expect(callCount).toBe(2);
    expect(result).toMatchObject({ id: 'abc' });
  });

  it('throws after exhausting retries on 500', async () => {
    const { ghlRequest } = await import('../src/http');
    vi.stubGlobal('fetch', async () => makeResponse(500, { error: 'always fails' }));
    await expect(
      ghlRequest(auth, { method: 'get', path: '/fail', retries: 1, timeoutMs: 5000 }),
    ).rejects.toThrow(GhlApiError);
  });

  it('throws GhlApiError(408) on timeout', async () => {
    const { ghlRequest } = await import('../src/http');
    vi.stubGlobal('fetch', async (_url: unknown, init: RequestInit) => {
      // Simulate AbortController abort
      return new Promise<Response>((_resolve, reject) => {
        const signal = init.signal as AbortSignal;
        if (signal) {
          signal.addEventListener('abort', () => {
            const err = new Error('The operation was aborted');
            err.name = 'AbortError';
            reject(err);
          });
        }
      });
    });
    await expect(
      ghlRequest(auth, { method: 'get', path: '/slow', timeoutMs: 50, retries: 0 }),
    ).rejects.toThrow(GhlApiError);
    try {
      await ghlRequest(auth, { method: 'get', path: '/slow', timeoutMs: 50, retries: 0 });
    } catch (e) {
      const err = e as GhlApiError;
      expect(err.status).toBe(408);
    }
  });

  it('honors Retry-After header on 429', async () => {
    const { ghlRequest } = await import('../src/http');
    let callCount = 0;
    vi.stubGlobal('fetch', async () => {
      callCount++;
      if (callCount === 1) {
        return new Response(JSON.stringify({ message: 'rate limited' }), {
          status: 429,
          headers: { 'content-type': 'application/json', 'Retry-After': '0' },
        });
      }
      return makeResponse(200, { ok: true });
    });
    const result = await ghlRequest(auth, {
      method: 'get',
      path: '/contacts',
      retries: 1,
      timeoutMs: 5000,
    });
    expect(callCount).toBe(2);
    expect(result).toMatchObject({ ok: true });
  });

  it('throws GhlApiError(0) on network error after retries exhausted', async () => {
    const { ghlRequest } = await import('../src/http');
    vi.stubGlobal('fetch', async () => {
      throw new Error('ECONNREFUSED');
    });
    await expect(
      ghlRequest(auth, { method: 'get', path: '/contacts', retries: 0, timeoutMs: 5000 }),
    ).rejects.toThrow(GhlApiError);
    try {
      await ghlRequest(auth, { method: 'get', path: '/contacts', retries: 0, timeoutMs: 5000 });
    } catch (e) {
      const err = e as GhlApiError;
      expect(err.status).toBe(0);
      expect(err.statusText).toBe('Network Error');
    }
  });
});
