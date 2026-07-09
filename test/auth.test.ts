import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

let tmpDir: string;

function mkTempDir(): string {
  const dir = join(tmpdir(), `ghl-auth-test-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe('auth', () => {
  beforeEach(() => {
    tmpDir = mkTempDir();
    process.env.XDG_CONFIG_HOME = tmpDir;
    // Clear env auth vars
    delete process.env.GHL_API_KEY;
    delete process.env.GHL_LOCATION_ID;
    delete process.env.GHL_PROFILE;
  });

  afterEach(() => {
    delete process.env.XDG_CONFIG_HOME;
    delete process.env.GHL_API_KEY;
    delete process.env.GHL_LOCATION_ID;
    delete process.env.GHL_PROFILE;
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('resolveAuth: step 1 — opts.apiKey takes priority', async () => {
    const { resolveAuth } = await import('../src/auth');
    process.env.GHL_API_KEY = 'should-not-use';
    const ctx = await resolveAuth({ apiKey: 'direct-key', location: 'loc-1' });
    expect(ctx.apiKey).toBe('direct-key');
    expect(ctx.locationId).toBe('loc-1');
    expect(ctx.profileName).toBeUndefined();
  });

  it('resolveAuth: step 1 — opts.apiKey without location', async () => {
    const { resolveAuth } = await import('../src/auth');
    const ctx = await resolveAuth({ apiKey: 'mykey' });
    expect(ctx.apiKey).toBe('mykey');
    expect(ctx.locationId).toBeUndefined();
  });

  it('resolveAuth: step 2 — GHL_API_KEY env', async () => {
    const { resolveAuth } = await import('../src/auth');
    process.env.GHL_API_KEY = 'env-key';
    process.env.GHL_LOCATION_ID = 'env-loc';
    const ctx = await resolveAuth({});
    expect(ctx.apiKey).toBe('env-key');
    expect(ctx.locationId).toBe('env-loc');
  });

  it('resolveAuth: step 2 — opts.location overrides GHL_LOCATION_ID when using env key', async () => {
    const { resolveAuth } = await import('../src/auth');
    process.env.GHL_API_KEY = 'env-key';
    process.env.GHL_LOCATION_ID = 'env-loc';
    const ctx = await resolveAuth({ location: 'override-loc' });
    expect(ctx.locationId).toBe('override-loc');
  });

  it('resolveAuth: step 3 — --profile flag', async () => {
    const { upsertProfile } = await import('../src/config');
    const { resolveAuth } = await import('../src/auth');
    upsertProfile({ name: 'myprofile', apiKey: 'prof-key', locationId: 'prof-loc' });
    const ctx = await resolveAuth({ profile: 'myprofile' });
    expect(ctx.apiKey).toBe('prof-key');
    expect(ctx.locationId).toBe('prof-loc');
    expect(ctx.profileName).toBe('myprofile');
  });

  it('resolveAuth: step 3 — opts.location overrides profile locationId', async () => {
    const { upsertProfile } = await import('../src/config');
    const { resolveAuth } = await import('../src/auth');
    upsertProfile({ name: 'p', apiKey: 'pk', locationId: 'original-loc' });
    const ctx = await resolveAuth({ profile: 'p', location: 'override-loc' });
    expect(ctx.locationId).toBe('override-loc');
  });

  it('resolveAuth: step 3 — throws UsageError for unknown profile', async () => {
    const { resolveAuth } = await import('../src/auth');
    const { UsageError } = await import('../src/types');
    expect(() => resolveAuth({ profile: 'nonexistent' })).toThrow(UsageError);
  });

  it('resolveAuth: step 3 — throws UsageError when profile has no apiKey', async () => {
    const { upsertProfile } = await import('../src/config');
    const { resolveAuth } = await import('../src/auth');
    const { UsageError } = await import('../src/types');
    upsertProfile({ name: 'nokey', locationId: 'loc' });
    expect(() => resolveAuth({ profile: 'nokey' })).toThrow(UsageError);
  });

  it('resolveAuth: step 4 — GHL_PROFILE env', async () => {
    const { upsertProfile } = await import('../src/config');
    const { resolveAuth } = await import('../src/auth');
    upsertProfile({ name: 'envprofile', apiKey: 'ep-key', locationId: 'ep-loc' });
    process.env.GHL_PROFILE = 'envprofile';
    const ctx = await resolveAuth({});
    expect(ctx.apiKey).toBe('ep-key');
    expect(ctx.profileName).toBe('envprofile');
  });

  it('resolveAuth: step 4 — throws UsageError when GHL_PROFILE not found', async () => {
    const { resolveAuth } = await import('../src/auth');
    const { UsageError } = await import('../src/types');
    process.env.GHL_PROFILE = 'ghost-profile';
    expect(() => resolveAuth({})).toThrow(UsageError);
  });

  it('resolveAuth: step 5 — default profile', async () => {
    const { upsertProfile, setDefaultProfile } = await import('../src/config');
    const { resolveAuth } = await import('../src/auth');
    upsertProfile({ name: 'a', apiKey: 'akey', locationId: 'aloc' });
    upsertProfile({ name: 'b', apiKey: 'bkey' });
    setDefaultProfile('a');
    const ctx = await resolveAuth({});
    expect(ctx.apiKey).toBe('akey');
    expect(ctx.profileName).toBe('a');
  });

  it('resolveAuth: step 5 — sole profile used when no default', async () => {
    const { upsertProfile } = await import('../src/config');
    const { resolveAuth } = await import('../src/auth');
    upsertProfile({ name: 'only', apiKey: 'only-key' });
    const ctx = await resolveAuth({});
    expect(ctx.apiKey).toBe('only-key');
  });

  it('resolveAuth: throws UsageError when nothing configured', async () => {
    const { resolveAuth } = await import('../src/auth');
    const { UsageError } = await import('../src/types');
    expect(() => resolveAuth({})).toThrow(UsageError);
    expect(() => resolveAuth({})).toThrow(/ghl auth add/);
  });

  describe('redactKey', () => {
    it('returns empty string for falsy input', async () => {
      const { redactKey } = await import('../src/auth');
      expect(redactKey(undefined)).toBe('');
      expect(redactKey('')).toBe('');
    });

    it('returns *** for keys 10 chars or fewer', async () => {
      const { redactKey } = await import('../src/auth');
      expect(redactKey('short')).toBe('***');
      expect(redactKey('1234567890')).toBe('***');
    });

    it('returns first4...last4 for longer keys', async () => {
      const { redactKey } = await import('../src/auth');
      expect(redactKey('pit-abc123def456')).toBe('pit-...f456');
    });

    it('does not reveal middle section', async () => {
      const { redactKey } = await import('../src/auth');
      const key = 'secretsecretsecretsecret';
      const redacted = redactKey(key);
      expect(redacted).not.toContain('secretsecret');
      expect(redacted.startsWith('secr')).toBe(true);
      expect(redacted.endsWith('cret')).toBe(true);
    });
  });
});
