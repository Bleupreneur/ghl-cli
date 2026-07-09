/** `ghl raw <METHOD> <path> …` — escape hatch to call any GHL API endpoint directly. */
import { readFileSync } from 'node:fs';
import { Command } from 'commander';
import { resolveAuth } from '../auth';
import { ghlRequest, type RequestSpec } from '../http';
import { printResult } from '../output';
import type { HttpMethod } from '../types';
import { UsageError } from '../types';

const METHODS = new Set(['get', 'post', 'put', 'delete', 'patch']);

function parseBody(data?: string): unknown {
  if (!data) return undefined;
  const raw = data.startsWith('@') ? readFileSync(data.slice(1), 'utf8') : data;
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new UsageError(`--data is not valid JSON: ${(e as Error).message}`);
  }
}

function parseQuery(pairs: string[] | undefined): Record<string, string> {
  const q: Record<string, string> = {};
  for (const p of pairs ?? []) {
    const i = p.indexOf('=');
    if (i < 0) throw new UsageError(`--query expects key=value, got '${p}'`);
    q[p.slice(0, i)] = p.slice(i + 1);
  }
  return q;
}

export function rawCommand(): Command {
  return new Command('raw')
    .description(
      'Call any GHL API endpoint directly (e.g. ghl raw GET /contacts/search/duplicate --query email=x@y.com)',
    )
    .argument('<method>', 'HTTP method: GET | POST | PUT | DELETE | PATCH')
    .argument('<path>', 'API path, e.g. /contacts/{id} — leading slash optional')
    .option('--query <kv...>', 'query parameter key=value (repeatable)')
    .option('--data <json>', 'JSON request body, inline or @path/to/file.json')
    .option('--version <v>', 'Version header (default 2021-07-28)')
    .option('--profile <name>', 'credential profile')
    .option('--api-key <key>', 'override API key')
    .option('--location <id>', 'override / inject locationId')
    .option('--json', 'force JSON output')
    .option('--pretty', 'pretty JSON output')
    .option('-q, --quiet', 'output only the data payload')
    .showHelpAfterError()
    .action(
      async (
        method: string,
        path: string,
        opts: {
          query?: string[];
          data?: string;
          version?: string;
          profile?: string;
          apiKey?: string;
          location?: string;
          json?: boolean;
          pretty?: boolean;
          quiet?: boolean;
        },
      ) => {
        const m = method.toLowerCase();
        if (!METHODS.has(m))
          throw new UsageError(
            `Unsupported method '${method}'. Use GET, POST, PUT, DELETE or PATCH.`,
          );
        const auth = await resolveAuth({
          apiKey: opts.apiKey,
          location: opts.location,
          profile: opts.profile,
        });
        const query = parseQuery(opts.query);
        if (!('locationId' in query) && !('altId' in query) && auth.locationId)
          query.locationId = auth.locationId;
        const spec: RequestSpec = {
          method: m as HttpMethod,
          path: path.startsWith('/') ? path : `/${path}`,
          query,
          body: parseBody(opts.data),
          version: opts.version,
        };
        const result = await ghlRequest(auth, spec);
        printResult(result, {
          json: opts.json === true,
          pretty: opts.pretty === true,
          quiet: opts.quiet === true,
        });
      },
    );
}
