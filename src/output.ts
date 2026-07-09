import type { OutputFormat } from './types';
import { GhlApiError, UsageError } from './types';

export interface OutputOptions {
  json?: boolean;
  pretty?: boolean;
  quiet?: boolean;
}

export function resolveFormat(opts: OutputOptions): OutputFormat {
  if (opts.pretty) return 'pretty';
  if (opts.json) return 'json';
  if (process.stdout.isTTY) return 'table';
  return 'json';
}

/** Extract the primary data payload from a response envelope. */
function unwrapPayload(data: unknown): unknown {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return data;
  const obj = data as Record<string, unknown>;
  const keys = Object.keys(obj);

  // Single key — return it directly
  if (keys.length === 1) {
    return obj[keys[0] as string];
  }

  // Well-known payload keys
  const wellKnown = ['data', 'contacts', 'contact', 'results', 'items', 'records'];
  for (const k of wellKnown) {
    if (k in obj) return obj[k];
  }

  return data;
}

/** Print an aligned text table for an array of flat-ish objects. */
function printTable(rows: unknown[]): boolean {
  if (rows.length === 0) {
    process.stdout.write('[empty]\n');
    return true;
  }

  const first = rows[0];
  if (typeof first !== 'object' || first === null || Array.isArray(first)) return false;

  const obj = first as Record<string, unknown>;
  const priorityCols = ['id', 'name', 'email', 'status', 'phone', 'type'];
  const allKeys = Object.keys(obj);

  // Pick up to 6 string/number/boolean columns
  const preferred = priorityCols.filter(
    (k) =>
      allKeys.includes(k) &&
      (typeof obj[k] === 'string' || typeof obj[k] === 'number' || typeof obj[k] === 'boolean'),
  );
  const rest = allKeys
    .filter(
      (k) =>
        !priorityCols.includes(k) &&
        (typeof obj[k] === 'string' || typeof obj[k] === 'number' || typeof obj[k] === 'boolean'),
    )
    .slice(0, 6 - preferred.length);

  const cols = [...preferred, ...rest].slice(0, 6);
  if (cols.length === 0) return false;

  // Compute column widths
  const widths: number[] = cols.map((c) => c.length);
  for (const row of rows) {
    if (typeof row !== 'object' || row === null) continue;
    const r = row as Record<string, unknown>;
    for (let i = 0; i < cols.length; i++) {
      const val = String(r[cols[i] as string] ?? '');
      if (val.length > (widths[i] ?? 0)) widths[i] = val.length;
    }
  }

  const pad = (s: string, w: number) => s.padEnd(w, ' ');

  // Header
  const header = cols.map((c, i) => pad(c, widths[i] ?? c.length)).join('  ');
  const separator = cols.map((_, i) => '-'.repeat(widths[i] ?? 1)).join('  ');
  process.stdout.write(`${header}\n`);
  process.stdout.write(`${separator}\n`);

  for (const row of rows) {
    if (typeof row !== 'object' || row === null) continue;
    const r = row as Record<string, unknown>;
    const line = cols.map((c, i) => pad(String(r[c] ?? ''), widths[i] ?? 0)).join('  ');
    process.stdout.write(`${line}\n`);
  }

  return true;
}

export function printResult(data: unknown, opts: OutputOptions): void {
  const format = resolveFormat(opts);
  const payload = opts.quiet ? unwrapPayload(data) : data;

  if (format === 'json') {
    process.stdout.write(`${JSON.stringify(payload)}\n`);
    return;
  }

  if (format === 'pretty') {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }

  // 'table' format
  // Try to find an array to render as a table
  const inner = opts.quiet ? payload : unwrapPayload(payload);

  if (Array.isArray(inner)) {
    const rendered = printTable(inner);
    if (!rendered) {
      process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    }
    return;
  }

  // Fall back to pretty JSON
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

export function printError(err: unknown): never {
  if (err instanceof UsageError) {
    process.stderr.write(`Error: ${err.message}\n`);
    process.exit(2);
  }

  if (err instanceof GhlApiError) {
    process.stderr.write(
      `Error: GHL API ${err.status} ${err.statusText} — ${err.method} ${err.url}\n`,
    );
    if (err.body !== undefined && err.body !== null && err.body !== '') {
      const bodyStr =
        typeof err.body === 'object' ? JSON.stringify(err.body, null, 2) : String(err.body);
      process.stderr.write(`${bodyStr}\n`);
    }
    process.exit(1);
  }

  if (err instanceof Error) {
    process.stderr.write(`Error: ${err.message}\n`);
  } else {
    process.stderr.write(`Error: ${String(err)}\n`);
  }
  process.exit(1);
}
