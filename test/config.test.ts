import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

let tmpDir: string;

function mkTempDir(): string {
  const dir = join(tmpdir(), `ghl-test-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe('config', () => {
  beforeEach(() => {
    tmpDir = mkTempDir();
    process.env.XDG_CONFIG_HOME = tmpDir;
  });

  afterEach(() => {
    delete process.env.XDG_CONFIG_HOME;
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('loadConfig returns empty profiles when file missing', async () => {
    const { loadConfig } = await import('../src/config');
    const cfg = loadConfig();
    expect(cfg).toEqual({ profiles: {} });
  });

  it('round-trip save and load', async () => {
    const { loadConfig, saveConfig } = await import('../src/config');
    const cfg = {
      default: 'myprofile',
      profiles: {
        myprofile: {
          name: 'myprofile',
          apiKey: 'key-123',
          locationId: 'loc-abc',
          kind: 'pit' as const,
        },
      },
    };
    saveConfig(cfg);
    const loaded = loadConfig();
    expect(loaded).toEqual(cfg);
  });

  it('saveConfig sets file permissions to 0o600', async () => {
    const { saveConfig, configPath } = await import('../src/config');
    saveConfig({ profiles: {} });
    const path = configPath();
    const stat = statSync(path);
    // On Unix the mode includes file type bits, so we mask
    expect(stat.mode & 0o777).toBe(0o600);
  });

  it('getProfile returns undefined when no profiles', async () => {
    const { getProfile } = await import('../src/config');
    expect(getProfile()).toBeUndefined();
  });

  it('getProfile returns sole profile when one exists', async () => {
    const { upsertProfile, getProfile } = await import('../src/config');
    const p = { name: 'solo', apiKey: 'k', locationId: 'l' };
    upsertProfile(p);
    expect(getProfile()).toEqual(p);
  });

  it('getProfile resolves by name', async () => {
    const { upsertProfile, getProfile } = await import('../src/config');
    upsertProfile({ name: 'a', apiKey: 'akey' });
    upsertProfile({ name: 'b', apiKey: 'bkey' });
    expect(getProfile('b')).toMatchObject({ name: 'b', apiKey: 'bkey' });
  });

  it('getProfile returns undefined for two profiles and no default and no name', async () => {
    const { upsertProfile, getProfile } = await import('../src/config');
    upsertProfile({ name: 'a', apiKey: 'akey' });
    upsertProfile({ name: 'b', apiKey: 'bkey' });
    expect(getProfile()).toBeUndefined();
  });

  it('getProfile uses config.default when multiple profiles', async () => {
    const { upsertProfile, getProfile, setDefaultProfile } = await import('../src/config');
    upsertProfile({ name: 'a', apiKey: 'akey' });
    upsertProfile({ name: 'b', apiKey: 'bkey' });
    setDefaultProfile('a');
    expect(getProfile()).toMatchObject({ name: 'a' });
  });

  it('removeProfile deletes the profile', async () => {
    const { upsertProfile, removeProfile, loadConfig } = await import('../src/config');
    upsertProfile({ name: 'del', apiKey: 'x' });
    removeProfile('del');
    const cfg = loadConfig();
    expect(cfg.profiles.del).toBeUndefined();
  });

  it('removeProfile clears default if it was the deleted profile', async () => {
    const { upsertProfile, setDefaultProfile, removeProfile, loadConfig } = await import(
      '../src/config'
    );
    upsertProfile({ name: 'x', apiKey: 'k' });
    setDefaultProfile('x');
    removeProfile('x');
    const cfg = loadConfig();
    expect(cfg.default).toBeUndefined();
  });

  it('setDefaultProfile throws UsageError on unknown profile', async () => {
    const { setDefaultProfile } = await import('../src/config');
    const { UsageError } = await import('../src/types');
    expect(() => setDefaultProfile('nobody')).toThrow(UsageError);
  });

  it('loadConfig handles corrupt file gracefully', async () => {
    const { configPath, loadConfig } = await import('../src/config');
    const path = configPath();
    mkdirSync(join(tmpDir, 'ghl'), { recursive: true });
    writeFileSync(path, 'not json!!!');
    const cfg = loadConfig();
    expect(cfg).toEqual({ profiles: {} });
  });

  it('configPath respects XDG_CONFIG_HOME', async () => {
    const { configPath } = await import('../src/config');
    const path = configPath();
    expect(path).toContain(tmpDir);
    expect(path).toContain('ghl');
    expect(path).toContain('config.json');
  });
});
