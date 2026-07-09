import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { CliConfig, Profile } from './types';
import { UsageError } from './types';

export function configPath(): string {
  const base = process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config');
  return join(base, 'ghl', 'config.json');
}

export function loadConfig(): CliConfig {
  const path = configPath();
  if (!existsSync(path)) return { profiles: {} };
  try {
    const raw = readFileSync(path, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed === 'object' && parsed !== null && 'profiles' in parsed) {
      return parsed as CliConfig;
    }
    return { profiles: {} };
  } catch {
    return { profiles: {} };
  }
}

export function saveConfig(config: CliConfig): void {
  const path = configPath();
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(path, JSON.stringify(config, null, 2), 'utf8');
  chmodSync(path, 0o600);
}

export function getProfile(name?: string): Profile | undefined {
  const config = loadConfig();
  const target = name ?? config.default;
  if (target !== undefined) {
    return config.profiles[target];
  }
  const keys = Object.keys(config.profiles);
  if (keys.length === 1) {
    const key = keys[0];
    return key !== undefined ? config.profiles[key] : undefined;
  }
  return undefined;
}

export function upsertProfile(p: Profile): void {
  const config = loadConfig();
  config.profiles[p.name] = p;
  saveConfig(config);
}

export function removeProfile(name: string): void {
  const config = loadConfig();
  delete config.profiles[name];
  if (config.default === name) {
    delete config.default;
  }
  saveConfig(config);
}

export function setDefaultProfile(name: string): void {
  const config = loadConfig();
  if (!(name in config.profiles)) {
    throw new UsageError(
      `No profile named "${name}". Run \`ghl auth list\` to see available profiles.`,
    );
  }
  config.default = name;
  saveConfig(config);
}
