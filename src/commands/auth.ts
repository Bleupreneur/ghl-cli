/** `ghl auth …` — manage credential profiles in ~/.config/ghl/config.json. */
import { Command } from 'commander';
import { redactKey } from '../auth';
import {
  configPath,
  getProfile,
  loadConfig,
  removeProfile,
  setDefaultProfile,
  upsertProfile,
} from '../config';
import { UsageError } from '../types';

function describeProfileLine(name: string, isDefault: boolean): string {
  const p = loadConfig().profiles[name];
  if (!p) return `  ${name}  (missing)`;
  const mark = isDefault ? '* ' : '  ';
  return `${mark}${name}  key=${redactKey(p.apiKey)}  location=${p.locationId ?? '(none)'}  kind=${p.kind ?? 'pit'}`;
}

export function authCommand(): Command {
  const auth = new Command('auth').description(
    'Manage GHL credential profiles (stored in ~/.config/ghl/config.json, chmod 600)',
  );
  auth.showHelpAfterError();

  auth
    .command('add')
    .description('Add or update a credential profile')
    .requiredOption('--name <name>', 'profile name (e.g. "work", "clientA")')
    .option('--api-key <key>', 'Private Integration Token (Settings → Private Integrations)')
    .option('--location <id>', 'default location (sub-account) ID for this profile')
    .option('--kind <kind>', 'credential kind: pit | agency', 'pit')
    .option('--default', 'also make this the default profile')
    // `--api-key` and `--location` are also declared on the root program, so commander stores
    // them there rather than on this subcommand. optsWithGlobals() merges both scopes.
    .action((_opts, cmd: Command) => {
      const opts = cmd.optsWithGlobals() as {
        name: string;
        apiKey?: string;
        location?: string;
        kind?: string;
        default?: boolean;
      };
      const kind = opts.kind === 'agency' ? 'agency' : 'pit';
      upsertProfile({ name: opts.name, apiKey: opts.apiKey, locationId: opts.location, kind });
      const cfg = loadConfig();
      if (opts.default || !cfg.default || Object.keys(cfg.profiles).length === 1) {
        setDefaultProfile(opts.name);
      }
      const isDefault = loadConfig().default === opts.name;
      console.log(`Saved profile '${opts.name}'${isDefault ? ' (default)' : ''} → ${configPath()}`);
      if (!opts.apiKey) {
        console.log(
          `  note: no --api-key set yet. Add it with: ghl auth add --name '${opts.name}' --api-key <token>`,
        );
      }
    });

  auth
    .command('list')
    .description('List credential profiles (tokens redacted)')
    .action(() => {
      const cfg = loadConfig();
      const names = Object.keys(cfg.profiles);
      if (names.length === 0) {
        console.log(
          'No profiles. Add one:\n  ghl auth add --name <name> --api-key <token> --location <id>',
        );
        return;
      }
      console.log(`Profiles (config: ${configPath()})`);
      for (const n of names) console.log(describeProfileLine(n, cfg.default === n));
    });

  auth
    .command('use')
    .description('Set the default profile')
    .argument('<name>', 'profile name')
    .action((name: string) => {
      setDefaultProfile(name);
      console.log(`Default profile → ${name}`);
    });

  auth
    .command('whoami')
    .description('Show the active (default-resolved) profile')
    .action(() => {
      const p = getProfile();
      if (!p) {
        console.log(
          'No active profile. Run: ghl auth add --name <name> --api-key <token> --location <id>',
        );
        return;
      }
      console.log(
        `profile=${p.name}  key=${redactKey(p.apiKey)}  location=${p.locationId ?? '(none)'}  kind=${p.kind ?? 'pit'}`,
      );
    });

  auth
    .command('rm')
    .description('Remove a profile')
    .argument('<name>', 'profile name')
    .action((name: string) => {
      if (!(name in loadConfig().profiles))
        throw new UsageError(`No profile named '${name}'. Run \`ghl auth list\`.`);
      removeProfile(name);
      console.log(`Removed profile '${name}'`);
    });

  return auth;
}
