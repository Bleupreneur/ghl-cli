import { readFileSync } from 'node:fs';
import type { RequestSpec } from './http';
import type { AuthContext, Operation, OpParam } from './types';
import { UsageError } from './types';

export interface ParsedArgs {
  positionals: string[];
  options: Record<string, unknown>;
  data?: string;
  set?: string[];
}

/** Convert kebab-case or snake_case param name → camelCase for commander option matching. */
function toCamelCase(name: string): string {
  return name.replace(/[-_]([a-z])/g, (_, c: string) => c.toUpperCase());
}

/** Look up a value from options by exact name or camelCase variant. */
function optionValue(options: Record<string, unknown>, name: string): unknown {
  if (name in options) return options[name];
  const camel = toCamelCase(name);
  if (camel in options) return options[camel];
  return undefined;
}

/** Coerce a raw value to a param's declared type. */
function coerceParam(value: unknown, type: OpParam['type'] | string): unknown {
  if (value === undefined || value === null) return value;
  if (type === 'number' || type === 'integer') {
    const n = Number(value);
    return Number.isNaN(n) ? value : n;
  }
  if (type === 'boolean') {
    if (typeof value === 'boolean') return value;
    return value === 'true' || value === '1';
  }
  if (type === 'array') {
    if (Array.isArray(value)) return value;
    return [String(value)];
  }
  return value;
}

/** Set a (possibly nested dotted-key) path on an object. */
function setDotted(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.');
  let current: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i] as string;
    if (!(part in current) || typeof current[part] !== 'object' || current[part] === null) {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }
  const last = parts[parts.length - 1] as string;
  current[last] = value;
}

/** Try to JSON-parse a value; if it fails, return as string. */
function tryParseValue(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

/** Parse --data: either JSON string or @file path. */
function parseDataArg(data: string): unknown {
  if (data.startsWith('@')) {
    const filePath = data.slice(1);
    const content = readFileSync(filePath, 'utf8');
    return JSON.parse(content) as unknown;
  }
  return JSON.parse(data) as unknown;
}

function isLocationLike(name: string): boolean {
  return name.toLowerCase() === 'locationid' || name.toLowerCase() === 'altid';
}

function isAltType(name: string): boolean {
  return name.toLowerCase() === 'alttype';
}

export function buildRequestSpec(op: Operation, args: ParsedArgs, auth: AuthContext): RequestSpec {
  // 1. Render path params
  let renderedPath = op.path;
  for (let i = 0; i < op.pathParams.length; i++) {
    const param = op.pathParams[i];
    if (!param) continue;
    const val = args.positionals[i];
    if (val === undefined || val === '') {
      throw new UsageError(`Missing required argument <${param.name}>`);
    }
    renderedPath = renderedPath.replace(`{${param.name}}`, encodeURIComponent(val));
  }

  // 2. Build query object
  const query: Record<string, string | number | boolean | string[] | undefined | null> = {};
  let locationInjectedInQuery = false;

  for (const param of op.queryParams) {
    const raw = optionValue(args.options, param.name);
    if (raw !== undefined && raw !== null && raw !== '') {
      query[param.name] = coerceParam(raw, param.type) as string | number | boolean | string[];
      if (isLocationLike(param.name)) locationInjectedInQuery = true;
    }
  }

  // Auto-inject locationId into query
  if (auth.locationId && !locationInjectedInQuery) {
    for (const param of op.queryParams) {
      if (isLocationLike(param.name) && !(param.name in query)) {
        query[param.name] = auth.locationId;
        locationInjectedInQuery = true;

        // If there's an altType param and we injected altId, set altType='location' unless given
        if (param.name.toLowerCase() === 'altid') {
          for (const p2 of op.queryParams) {
            if (isAltType(p2.name)) {
              const existing = optionValue(args.options, p2.name);
              if (existing === undefined || existing === null || existing === '') {
                query[p2.name] = 'location';
              }
              break;
            }
          }
        }
        break;
      }
    }
  }

  // 3. Build body (only if op.hasBody)
  let body: Record<string, unknown> | undefined;

  if (op.hasBody) {
    let base: Record<string, unknown> = {};

    // Parse --data if provided
    if (args.data !== undefined) {
      const parsed = parseDataArg(args.data);
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        base = parsed as Record<string, unknown>;
      } else {
        base = { data: parsed };
      }
    }

    // Apply known body fields from options
    for (const field of op.bodyFields) {
      const raw = optionValue(args.options, field.name);
      if (raw !== undefined && raw !== null && raw !== '') {
        base[field.name] = coerceParam(raw, field.type);
      }
    }

    // Apply --set key=value (dotted keys, JSON-parsed values)
    if (args.set) {
      for (const entry of args.set) {
        const eqIdx = entry.indexOf('=');
        if (eqIdx < 0) continue;
        const k = entry.slice(0, eqIdx);
        const v = entry.slice(eqIdx + 1);
        setDotted(base, k, tryParseValue(v));
      }
    }

    body = base;

    // Auto-inject locationId into body if:
    // - op has no locationId/altId query param
    // - user didn't supply it
    // - auth.locationId is set
    // - locationId is in bodyFields OR op.bodyIsOpen
    const hasLocationQueryParam = op.queryParams.some((p) => isLocationLike(p.name));

    if (auth.locationId && !hasLocationQueryParam) {
      // Try to inject locationId
      const locationBodyField = op.bodyFields.find((f) => f.name.toLowerCase() === 'locationid');
      const altIdBodyField = op.bodyFields.find((f) => f.name.toLowerCase() === 'altid');

      if (locationBodyField && !('locationId' in body)) {
        body.locationId = auth.locationId;
      } else if (altIdBodyField && !('altId' in body)) {
        body.altId = auth.locationId;
        // Set altType if field exists and not already set
        const altTypeBodyField = op.bodyFields.find((f) => isAltType(f.name));
        if (altTypeBodyField && !('altType' in body)) {
          body.altType = 'location';
        }
      } else if (op.bodyIsOpen && !('locationId' in body) && !('altId' in body)) {
        body.locationId = auth.locationId;
      }
    }
  }

  // 4. For GET, never send a body; for DELETE, send body only if non-empty
  const sendBody =
    op.method !== 'get' &&
    body !== undefined &&
    (op.method !== 'delete' || Object.keys(body).length > 0);

  return {
    method: op.method,
    path: renderedPath,
    query: Object.keys(query).length > 0 ? query : undefined,
    body: sendBody ? body : undefined,
    version: op.version,
  };
}

export function describeOperation(op: Operation): string {
  const lines: string[] = [];
  lines.push(`ghl ${op.domain} ${op.command}`);
  if (op.summary) lines.push(op.summary);
  if (op.description && op.description !== op.summary) lines.push('', op.description);

  lines.push('');
  lines.push(`${op.method.toUpperCase()} ${op.path}`);

  if (op.pathParams.length > 0) {
    lines.push('');
    lines.push('Arguments:');
    for (const p of op.pathParams) {
      lines.push(`  <${p.name}>${p.description ? `  ${p.description}` : ''}`);
    }
  }

  const flags = [...op.queryParams, ...op.bodyFields];
  if (flags.length > 0) {
    lines.push('');
    lines.push('Flags:');
    for (const f of flags) {
      const req = 'required' in f && f.required ? ' (required)' : '';
      lines.push(`  --${f.name}${req}${f.description ? `  ${f.description}` : ''}`);
    }
  }

  if (op.bodyFields.length > 0) {
    lines.push('');
    lines.push('Body fields:');
    for (const f of op.bodyFields) {
      const req = f.required ? ' (required)' : '';
      lines.push(`  --${f.name}${req}  [${f.type}]${f.description ? `  ${f.description}` : ''}`);
    }
  }

  if (op.scopes.length > 0) {
    lines.push('');
    lines.push(`Scopes: ${op.scopes.join(', ')}`);
  }

  if (op.docsUrl) {
    lines.push(`Docs: ${op.docsUrl}`);
  }

  return lines.join('\n');
}
