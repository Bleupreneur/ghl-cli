import { getProfile } from './config';
import type { AuthContext, Profile } from './types';
import { UsageError } from './types';

export interface AuthOptions {
  apiKey?: string;
  location?: string;
  profile?: string;
}

function authFromProfile(p: Profile, opts: AuthOptions, source: string): AuthContext {
  if (!p.apiKey) {
    throw new UsageError(
      `Profile "${p.name}"${source} has no apiKey. Run \`ghl auth add --name ${p.name} --api-key <token>\` to set one.`,
    );
  }
  return { apiKey: p.apiKey, locationId: opts.location ?? p.locationId, profileName: p.name };
}

export function resolveAuth(opts: AuthOptions): AuthContext {
  // 1. --api-key flag (+ optional --location)
  if (opts.apiKey) {
    return { apiKey: opts.apiKey, locationId: opts.location, profileName: undefined };
  }

  // 2. GHL_API_KEY env (+ optional GHL_LOCATION_ID)
  const envKey = process.env.GHL_API_KEY;
  if (envKey) {
    return {
      apiKey: envKey,
      locationId: opts.location ?? process.env.GHL_LOCATION_ID,
      profileName: undefined,
    };
  }

  // 3. --profile flag
  if (opts.profile !== undefined) {
    const p = getProfile(opts.profile);
    if (!p) {
      throw new UsageError(
        `No profile named "${opts.profile}". Run \`ghl auth list\` to see available profiles.`,
      );
    }
    return authFromProfile(p, opts, '');
  }

  // 4. GHL_PROFILE env
  const envProfile = process.env.GHL_PROFILE;
  if (envProfile) {
    const p = getProfile(envProfile);
    if (!p) {
      throw new UsageError(
        `GHL_PROFILE="${envProfile}" does not match any saved profile. Run \`ghl auth list\` to see available profiles.`,
      );
    }
    return authFromProfile(p, opts, ' (from GHL_PROFILE)');
  }

  // 5. default profile (or sole profile)
  const p = getProfile();
  if (p) return authFromProfile(p, opts, '');

  throw new UsageError(
    'No GHL credentials. Run `ghl auth add --name <name> --api-key <token> --location <id>`, ' +
      'or pass --api-key/--location, or set GHL_API_KEY/GHL_LOCATION_ID. ' +
      'Create a Private Integration Token in GHL: Settings → Private Integrations.',
  );
}

export function redactKey(key: string | undefined): string {
  if (!key) return '';
  if (key.length <= 10) return '***';
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}
