import { rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AuthContext, Operation } from '../src/types';
import { UsageError } from '../src/types';

const baseAuth: AuthContext = { apiKey: 'key', locationId: 'loc-123' };

function makeOp(overrides: Partial<Operation> = {}): Operation {
  return {
    id: 'test-op',
    domain: 'contacts',
    command: 'get',
    method: 'get',
    path: '/contacts',
    pathParams: [],
    queryParams: [],
    headerParams: [],
    hasBody: false,
    bodyFields: [],
    bodyIsOpen: false,
    version: '2021-07-28',
    scopes: [],
    summary: 'Test op',
    description: 'Test op desc',
    tags: [],
    ...overrides,
  };
}

describe('params', () => {
  it('renders path params from positionals', async () => {
    const { buildRequestSpec } = await import('../src/params');
    const op = makeOp({
      path: '/contacts/{contactId}/tags/{tagId}',
      pathParams: [
        { name: 'contactId', in: 'path', required: true, type: 'string' },
        { name: 'tagId', in: 'path', required: true, type: 'string' },
      ],
    });
    const spec = buildRequestSpec(
      op,
      { positionals: ['contact-abc', 'tag-xyz'], options: {} },
      baseAuth,
    );
    expect(spec.path).toBe('/contacts/contact-abc/tags/tag-xyz');
  });

  it('throws UsageError for missing required positional', async () => {
    const { buildRequestSpec } = await import('../src/params');
    const op = makeOp({
      path: '/contacts/{contactId}',
      pathParams: [{ name: 'contactId', in: 'path', required: true, type: 'string' }],
    });
    expect(() => buildRequestSpec(op, { positionals: [], options: {} }, baseAuth)).toThrow(
      UsageError,
    );
    expect(() => buildRequestSpec(op, { positionals: [], options: {} }, baseAuth)).toThrow(
      /contactId/,
    );
  });

  it('maps query params from options (exact match)', async () => {
    const { buildRequestSpec } = await import('../src/params');
    const op = makeOp({
      method: 'get',
      queryParams: [
        { name: 'limit', in: 'query', required: false, type: 'number' },
        { name: 'query', in: 'query', required: false, type: 'string' },
      ],
    });
    const spec = buildRequestSpec(
      op,
      { positionals: [], options: { limit: '20', query: 'john' } },
      { ...baseAuth, locationId: undefined },
    );
    expect(spec.query).toMatchObject({ limit: 20, query: 'john' });
  });

  it('maps query params via camelCase conversion', async () => {
    const { buildRequestSpec } = await import('../src/params');
    const op = makeOp({
      method: 'get',
      queryParams: [{ name: 'start_after', in: 'query', required: false, type: 'string' }],
    });
    const spec = buildRequestSpec(
      op,
      { positionals: [], options: { startAfter: 'cursor-abc' } },
      { ...baseAuth, locationId: undefined },
    );
    expect(spec.query?.start_after).toBe('cursor-abc');
  });

  it('auto-injects locationId into query when param declared', async () => {
    const { buildRequestSpec } = await import('../src/params');
    const op = makeOp({
      method: 'get',
      queryParams: [{ name: 'locationId', in: 'query', required: false, type: 'string' }],
    });
    const spec = buildRequestSpec(op, { positionals: [], options: {} }, baseAuth);
    expect(spec.query?.locationId).toBe('loc-123');
  });

  it('auto-injects altId into query and sets altType=location', async () => {
    const { buildRequestSpec } = await import('../src/params');
    const op = makeOp({
      method: 'get',
      queryParams: [
        { name: 'altId', in: 'query', required: false, type: 'string' },
        { name: 'altType', in: 'query', required: false, type: 'string' },
      ],
    });
    const spec = buildRequestSpec(op, { positionals: [], options: {} }, baseAuth);
    expect(spec.query?.altId).toBe('loc-123');
    expect(spec.query?.altType).toBe('location');
  });

  it('does not override explicitly provided locationId', async () => {
    const { buildRequestSpec } = await import('../src/params');
    const op = makeOp({
      method: 'get',
      queryParams: [{ name: 'locationId', in: 'query', required: false, type: 'string' }],
    });
    const spec = buildRequestSpec(
      op,
      { positionals: [], options: { locationId: 'explicit-loc' } },
      baseAuth,
    );
    expect(spec.query?.locationId).toBe('explicit-loc');
  });

  it('coerces query param types: number, boolean, array', async () => {
    const { buildRequestSpec } = await import('../src/params');
    const op = makeOp({
      method: 'get',
      queryParams: [
        { name: 'page', in: 'query', required: false, type: 'number' },
        { name: 'active', in: 'query', required: false, type: 'boolean' },
        { name: 'tags', in: 'query', required: false, type: 'array' },
      ],
    });
    const spec = buildRequestSpec(
      op,
      { positionals: [], options: { page: '3', active: 'true', tags: 'single' } },
      { ...baseAuth, locationId: undefined },
    );
    expect(spec.query?.page).toBe(3);
    expect(spec.query?.active).toBe(true);
    expect(Array.isArray(spec.query?.tags)).toBe(true);
  });

  it('GET never sends a body', async () => {
    const { buildRequestSpec } = await import('../src/params');
    const op = makeOp({
      method: 'get',
      hasBody: true,
      bodyFields: [{ name: 'name', required: false, type: 'string' }],
    });
    const spec = buildRequestSpec(
      op,
      { positionals: [], options: { name: 'test' }, set: ['extra=value'] },
      { ...baseAuth, locationId: undefined },
    );
    expect(spec.body).toBeUndefined();
  });

  it('builds body from known body fields (POST)', async () => {
    const { buildRequestSpec } = await import('../src/params');
    const op = makeOp({
      method: 'post',
      hasBody: true,
      bodyFields: [
        { name: 'firstName', required: true, type: 'string' },
        { name: 'email', required: false, type: 'string' },
      ],
    });
    const spec = buildRequestSpec(
      op,
      { positionals: [], options: { firstName: 'John', email: 'j@example.com' } },
      { ...baseAuth, locationId: undefined },
    );
    expect(spec.body).toMatchObject({ firstName: 'John', email: 'j@example.com' });
  });

  it('processes --data inline JSON', async () => {
    const { buildRequestSpec } = await import('../src/params');
    const op = makeOp({ method: 'post', hasBody: true, bodyIsOpen: true });
    const spec = buildRequestSpec(
      op,
      { positionals: [], options: {}, data: '{"name":"Test","value":42}' },
      { ...baseAuth, locationId: undefined },
    );
    expect(spec.body).toMatchObject({ name: 'Test', value: 42 });
  });

  it('processes --data @file JSON', async () => {
    const { buildRequestSpec } = await import('../src/params');
    const tmpFile = join(tmpdir(), `ghl-params-test-${Math.random().toString(36).slice(2)}.json`);
    writeFileSync(tmpFile, JSON.stringify({ key: 'fileValue', count: 5 }));
    const op = makeOp({ method: 'post', hasBody: true, bodyIsOpen: true });
    const spec = buildRequestSpec(
      op,
      { positionals: [], options: {}, data: `@${tmpFile}` },
      { ...baseAuth, locationId: undefined },
    );
    expect(spec.body).toMatchObject({ key: 'fileValue', count: 5 });
    rmSync(tmpFile);
  });

  it('processes --set with dotted keys and JSON coercion', async () => {
    const { buildRequestSpec } = await import('../src/params');
    const op = makeOp({ method: 'post', hasBody: true, bodyIsOpen: true });
    const spec = buildRequestSpec(
      op,
      {
        positionals: [],
        options: {},
        set: ['name=Alice', 'meta.active=true', 'meta.count=3', 'tags=["a","b"]'],
      },
      { ...baseAuth, locationId: undefined },
    );
    const body = spec.body as Record<string, unknown>;
    expect(body.name).toBe('Alice');
    expect((body.meta as Record<string, unknown>).active).toBe(true);
    expect((body.meta as Record<string, unknown>).count).toBe(3);
    expect(body.tags).toEqual(['a', 'b']);
  });

  it('auto-injects locationId into body (bodyFields contains locationId)', async () => {
    const { buildRequestSpec } = await import('../src/params');
    const op = makeOp({
      method: 'post',
      hasBody: true,
      bodyFields: [
        { name: 'locationId', required: true, type: 'string' },
        { name: 'name', required: true, type: 'string' },
      ],
    });
    const spec = buildRequestSpec(op, { positionals: [], options: { name: 'Test' } }, baseAuth);
    expect((spec.body as Record<string, unknown>).locationId).toBe('loc-123');
  });

  it('auto-injects locationId into body (bodyIsOpen, no query locationId)', async () => {
    const { buildRequestSpec } = await import('../src/params');
    const op = makeOp({
      method: 'post',
      hasBody: true,
      bodyIsOpen: true,
    });
    const spec = buildRequestSpec(
      op,
      { positionals: [], options: {}, set: ['name=Test'] },
      baseAuth,
    );
    expect((spec.body as Record<string, unknown>).locationId).toBe('loc-123');
  });

  it('does NOT inject locationId into body when query has locationId param', async () => {
    const { buildRequestSpec } = await import('../src/params');
    const op = makeOp({
      method: 'post',
      hasBody: true,
      bodyIsOpen: true,
      queryParams: [{ name: 'locationId', in: 'query', required: false, type: 'string' }],
    });
    const spec = buildRequestSpec(op, { positionals: [], options: {} }, baseAuth);
    const body = spec.body as Record<string, unknown>;
    expect(body?.locationId).toBeUndefined();
  });

  it('describeOperation returns a multi-line string with method and path', async () => {
    const { describeOperation } = await import('../src/params');
    const op = makeOp({
      method: 'post',
      path: '/contacts/{contactId}',
      summary: 'Create a contact',
      pathParams: [{ name: 'contactId', in: 'path', required: true, type: 'string' }],
      queryParams: [{ name: 'locationId', in: 'query', required: false, type: 'string' }],
      bodyFields: [{ name: 'firstName', required: true, type: 'string' }],
      scopes: ['contacts.readonly'],
      docsUrl: 'https://docs.example.com',
    });
    const desc = describeOperation(op);
    expect(desc).toContain('POST');
    expect(desc).toContain('/contacts/{contactId}');
    expect(desc).toContain('Create a contact');
    expect(desc).toContain('contactId');
    expect(desc).toContain('locationId');
    expect(desc).toContain('contacts.readonly');
    expect(desc).toContain('https://docs.example.com');
  });
});
