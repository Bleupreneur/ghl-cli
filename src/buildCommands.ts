/**
 * Turn the generated `OPERATIONS` list into a Commander command tree.
 *
 * Layout:  ghl <domain> <command> [<pathParam>...] [--queryFlag <v>...] [--bodyField <v>...] [--set k=v...] [--data <json>]
 *
 * Every leaf command is data-driven from one `Operation` record — there is no per-endpoint
 * hand-written code. Adding GHL endpoints = re-run `pnpm gen`.
 */
import { Command } from 'commander';
import { resolveAuth } from './auth';
import { OPERATIONS } from './generated/operations';
import { ghlRequest } from './http';
import { printResult } from './output';
import type { ParsedArgs } from './params';
import { buildRequestSpec, describeOperation } from './params';
import type { Operation, OpParam } from './types';

/** Param names we never expose as generated flags — supplied via `--location` + auto-injection instead. */
const SUPPRESSED_PARAMS = new Set(['locationId', 'altId', 'altType']);

/** kebab-case a param name for the CLI flag (`startAfterId` -> `start-after-id`). Commander camelizes it back. */
function flagName(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/_/g, '-')
    .toLowerCase();
}

function paramHelp(p: OpParam): string {
  const bits: string[] = [];
  if (p.description) bits.push(p.description);
  if (p.enum?.length) bits.push(`one of: ${p.enum.join(', ')}`);
  if (p.default !== undefined) bits.push(`default: ${p.default}`);
  if (p.type === 'array') bits.push('repeatable');
  return bits.join(' — ');
}

/** Options shared by every leaf command (also defined on the root program). */
function addCommonOptions(cmd: Command): Command {
  return cmd
    .option('--profile <name>', 'credential profile to use')
    .option('--api-key <key>', 'override API key for this call')
    .option('--location <id>', 'target / inject this locationId (sub-account)')
    .option('--json', 'force JSON output')
    .option('--pretty', 'pretty-printed JSON output')
    .option('-q, --quiet', 'output only the data payload');
}

function buildLeaf(op: Operation): Command {
  const leaf = new Command(op.command).description(op.summary || op.id);

  // Positional args = path params, in path-template order.
  for (const p of op.pathParams) {
    leaf.argument(`<${p.name}>`, paramHelp(p) || `${p.name} (path)`);
  }

  // Track flag names to avoid Commander "duplicate option" crashes.
  const seen = new Set<string>([
    'profile',
    'api-key',
    'location',
    'json',
    'pretty',
    'quiet',
    'data',
    'set',
  ]);
  const claim = (n: string) => {
    if (seen.has(n)) return false;
    seen.add(n);
    return true;
  };

  // Query params -> --flags.
  for (const p of op.queryParams) {
    if (SUPPRESSED_PARAMS.has(p.name)) continue;
    const fn = flagName(p.name);
    if (!claim(fn)) continue;
    const help = `[query] ${paramHelp(p)}`.trim();
    if (p.type === 'boolean') leaf.option(`--${fn}`, help);
    else if (p.type === 'array') leaf.option(`--${fn} <values...>`, help);
    else leaf.option(`--${fn} <value>`, help);
  }

  // Documented body fields -> --flags. Plus --set / --data for everything else.
  if (op.hasBody) {
    for (const f of op.bodyFields) {
      if (SUPPRESSED_PARAMS.has(f.name)) continue;
      const fn = flagName(f.name);
      if (!claim(fn)) continue;
      const bits = [`[body${f.required ? ', required' : ''}]`];
      if (f.description) bits.push(f.description);
      if (f.enum?.length) bits.push(`one of: ${f.enum.join(', ')}`);
      const help = bits.join(' — ');
      if (f.type === 'boolean') leaf.option(`--${fn}`, help);
      else if (f.type === 'array') leaf.option(`--${fn} <values...>`, help);
      else leaf.option(`--${fn} <value>`, help);
    }
    leaf.option(
      '--set <kv...>',
      'set a request-body field: key=value (JSON values ok; dotted keys nest). Repeatable.',
    );
    leaf.option('--data <json>', 'full JSON request body, inline or @path/to/file.json');
  }

  addCommonOptions(leaf);

  // API reference in --help.
  leaf.addHelpText('after', `\n${describeOperation(op)}`);

  leaf.action(async (...args: unknown[]) => {
    const cmd = args.pop() as Command;
    args.pop(); // per-command opts; we read merged opts via optsWithGlobals()
    const positionals = args.map((a) => String(a));
    const opts = cmd.optsWithGlobals() as Record<string, unknown>;

    const auth = resolveAuth({
      apiKey: typeof opts.apiKey === 'string' ? opts.apiKey : undefined,
      location: typeof opts.location === 'string' ? opts.location : undefined,
      profile: typeof opts.profile === 'string' ? opts.profile : undefined,
    });

    const parsed: ParsedArgs = {
      positionals,
      options: opts,
      data: typeof opts.data === 'string' ? opts.data : undefined,
      set: Array.isArray(opts.set) ? (opts.set as string[]) : undefined,
    };

    const spec = buildRequestSpec(op, parsed, auth);
    const result = await ghlRequest(auth, spec);
    printResult(result, {
      json: opts.json === true,
      pretty: opts.pretty === true,
      quiet: opts.quiet === true,
    });
  });

  return leaf;
}

/** All domain commands (one Command per spec file), each with its operations as subcommands. */
export function buildDomainCommands(): Command[] {
  const byDomain = new Map<string, Operation[]>();
  for (const op of OPERATIONS) {
    const list = byDomain.get(op.domain);
    if (list) list.push(op);
    else byDomain.set(op.domain, [op]);
  }

  const commands: Command[] = [];
  for (const domain of [...byDomain.keys()].sort()) {
    const ops = byDomain.get(domain)!;
    const domainCmd = new Command(domain).description(
      `GHL ${domain} API — ${ops.length} operation(s). Run \`ghl ${domain} <command> --help\` for flags.`,
    );
    for (const op of ops) domainCmd.addCommand(buildLeaf(op));
    domainCmd.showHelpAfterError();
    commands.push(domainCmd);
  }
  return commands;
}

/** Sorted list of domain names (for `ghl --help`). */
export function listDomains(): string[] {
  return [...new Set(OPERATIONS.map((o) => o.domain))].sort();
}
