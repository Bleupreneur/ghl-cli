import type { AuthContext } from './types';
import { BASE_URL, DEFAULT_VERSION, GhlApiError } from './types';

export interface RequestSpec {
  method: import('./types').HttpMethod;
  path: string;
  query?: Record<string, string | number | boolean | string[] | undefined | null>;
  body?: unknown;
  version?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
  retries?: number;
}

function buildUrl(
  path: string,
  query?: Record<string, string | number | boolean | string[] | undefined | null>,
): string {
  const base = BASE_URL + path;
  if (!query) return base;

  const params: string[] = [];
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) {
      for (const item of v) {
        params.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(item))}`);
      }
    } else {
      params.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
    }
  }

  if (params.length === 0) return base;
  return `${base}?${params.join('&')}`;
}

async function parseBody(response: Response): Promise<unknown> {
  const ct = response.headers.get('content-type') ?? '';
  const text = await response.text();
  if (!text) return { ok: true };
  if (
    ct.includes('application/json') ||
    text.trimStart().startsWith('{') ||
    text.trimStart().startsWith('[')
  ) {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return text;
    }
  }
  return text;
}

function retryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status < 600);
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function ghlRequest(auth: AuthContext, spec: RequestSpec): Promise<unknown> {
  const {
    method,
    path,
    query,
    body,
    version,
    headers: extraHeaders,
    timeoutMs = 30_000,
    retries = 2,
  } = spec;

  const url = buildUrl(path, query);
  const versionHeader = version ?? DEFAULT_VERSION;

  const baseHeaders: Record<string, string> = {
    Authorization: `Bearer ${auth.apiKey}`,
    Version: versionHeader,
    Accept: 'application/json',
    ...(body !== undefined && method !== 'get' ? { 'Content-Type': 'application/json' } : {}),
    ...extraHeaders,
  };

  const hasBody = body !== undefined && method !== 'get';

  let attempt = 0;
  const maxAttempts = retries + 1;

  while (attempt < maxAttempts) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;
    try {
      response = await fetch(url, {
        method: method.toUpperCase(),
        headers: baseHeaders,
        body: hasBody ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      const isAbort =
        err instanceof Error && (err.name === 'AbortError' || err.message.includes('abort'));
      if (isAbort) {
        throw new GhlApiError(
          408,
          'Request Timeout',
          `Timed out after ${timeoutMs}ms`,
          method.toUpperCase(),
          url,
        );
      }
      if (attempt < maxAttempts - 1) {
        attempt++;
        const backoff = 500 * 3 ** (attempt - 1);
        await sleep(backoff);
        continue;
      }
      throw new GhlApiError(0, 'Network Error', String(err), method.toUpperCase(), url);
    }
    clearTimeout(timer);

    if (response.ok) {
      if (response.status === 204) return { ok: true };
      return await parseBody(response);
    }

    // Non-2xx
    if (retryableStatus(response.status) && attempt < maxAttempts - 1) {
      const retryAfterHeader = response.headers.get('Retry-After');
      let delay = 500 * 3 ** attempt;
      if (retryAfterHeader) {
        const seconds = parseFloat(retryAfterHeader);
        if (!Number.isNaN(seconds)) delay = seconds * 1000;
      }
      attempt++;
      await sleep(delay);
      continue;
    }

    // Final error — parse body and throw
    const errBody = await parseBody(response);
    throw new GhlApiError(response.status, response.statusText, errBody, method.toUpperCase(), url);
  }

  // Should never reach here
  throw new GhlApiError(0, 'Network Error', 'Exhausted retries', method.toUpperCase(), url);
}
