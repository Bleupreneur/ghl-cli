import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let tmpDir: string;

/**
 * Rebuild the root program the way `src/cli.ts` does — in particular re-declaring the
 * `--profile` / `--api-key` / `--location` globals, since those collide with `auth add`'s
 * own flags and are the reason `auth add` must read `optsWithGlobals()`.
 */
async function runAuth(argv: string[]): Promise<void> {
  const { authCommand } = await import('../src/commands/auth');
  const program = new Command('ghl');
  program
    .option('--profile <name>', 'credential profile to use')
    .option('--api-key <key>', 'override API key for this invocation')
    .option('--location <id>', 'override / inject the locationId (sub-account)');
  program.addCommand(authCommand());
  program.exitOverride();
  await program.parseAsync(argv, { from: 'user' });
}

describe('ghl auth add', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    tmpDir = join(tmpdir(), `ghl-cmd-auth-test-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpDir, { recursive: true });
    process.env.XDG_CONFIG_HOME = tmpDir;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.XDG_CONFIG_HOME;
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('stores --api-key and --location even though both collide with root globals', async () => {
    await runAuth([
      'auth',
      'add',
      '--name',
      'work',
      '--api-key',
      'pit-abc-123',
      '--location',
      'L1',
    ]);
    const { loadConfig } = await import('../src/config');
    const p = loadConfig().profiles.work;
    expect(p?.apiKey).toBe('pit-abc-123');
    expect(p?.locationId).toBe('L1');
    expect(p?.kind).toBe('pit');
  });

  it('makes the first profile the default', async () => {
    await runAuth(['auth', 'add', '--name', 'solo', '--api-key', 'pit-1']);
    const { loadConfig } = await import('../src/config');
    expect(loadConfig().default).toBe('solo');
  });

  it('--default switches the default profile', async () => {
    await runAuth(['auth', 'add', '--name', 'a', '--api-key', 'pit-a']);
    await runAuth(['auth', 'add', '--name', 'b', '--api-key', 'pit-b', '--default']);
    const { loadConfig } = await import('../src/config');
    expect(loadConfig().default).toBe('b');
  });

  it('--kind agency is honoured; anything else falls back to pit', async () => {
    await runAuth(['auth', 'add', '--name', 'ag', '--api-key', 'k', '--kind', 'agency']);
    await runAuth(['auth', 'add', '--name', 'weird', '--api-key', 'k', '--kind', 'nonsense']);
    const { loadConfig } = await import('../src/config');
    const cfg = loadConfig();
    expect(cfg.profiles.ag?.kind).toBe('agency');
    expect(cfg.profiles.weird?.kind).toBe('pit');
  });

  it('a profile added without --api-key round-trips as tokenless', async () => {
    await runAuth(['auth', 'add', '--name', 'empty']);
    const { loadConfig } = await import('../src/config');
    expect(loadConfig().profiles.empty?.apiKey).toBeUndefined();
  });
});
