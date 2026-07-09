/**
 * scripts/gen.ts — CodeGen for ghl-cli
 *
 * Reads spec/*.json (GHL OpenAPI v3 specs) and emits src/generated/operations.ts
 * containing a typed Operation[] array used by the CLI at runtime.
 *
 * Run: pnpm gen  (tsx scripts/gen.ts)
 */

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { OpBodyField, Operation, OpParam } from '../src/types.js';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const SPEC_DIR = join(ROOT, 'spec');
const OUT_FILE = join(ROOT, 'src', 'generated', 'operations.ts');

// ---------------------------------------------------------------------------
// OpenAPI type stubs (we read JSON at runtime so these are loose)
// ---------------------------------------------------------------------------

type JsonSchema = Record<string, unknown>;
type OpenApiParam = {
  name: string;
  in: string;
  required?: boolean;
  description?: string;
  schema?: JsonSchema;
};
type OpenApiOperation = {
  operationId?: string;
  summary?: string;
  description?: string;
  parameters?: OpenApiParam[];
  requestBody?: {
    content?: Record<string, { schema?: JsonSchema }>;
  };
  security?: Array<Record<string, string[]>>;
  externalDocs?: { url?: string };
  tags?: string[];
};
type OpenApiSpec = {
  paths?: Record<string, Record<string, OpenApiOperation>>;
  components?: { schemas?: Record<string, JsonSchema> };
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ALLOWED_METHODS = new Set(['get', 'post', 'put', 'delete', 'patch']);
const DEFAULT_VERSION = '2021-07-28';

/** Convert an arbitrary string to kebab-case. */
function toKebab(s: string): string {
  return s
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .replace(/[_\s/{}]+/g, '-')
    .replace(/[^a-z0-9-]/gi, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
}

/** Extract ordered path-param names from a path template, e.g. `/a/{b}/c/{d}` → ['b','d']. */
function extractPathParamNames(path: string): string[] {
  const matches = path.match(/\{([^}]+)\}/g) ?? [];
  return matches.map((m) => m.slice(1, -1));
}

/** Parse `{param}` segments from an operationId to derive a clean command name. */
function deriveCommand(operationId: string, domain: string): string {
  const kb = toKebab(operationId);

  // Common normalization: strip leading verb + domain overlap
  // e.g.  contacts + get-contact → get
  //       contacts + create-contact → create
  //       contacts + list-contacts → list
  const domainKb = toKebab(domain);

  // Try to strip a trailing or embedded domain word
  // (e.g. "get-contact-by-id" for domain "contacts" → "get-contact-by-id" is fine)
  // Prefer simple patterns: get-<domain-singular>, create-<domain-singular>, etc.
  const singular = domainKb.replace(/-s$/, '').replace(/ies$/, 'y');
  const singularAlt = domainKb.endsWith('s') ? domainKb.slice(0, -1) : domainKb;

  // Strip domain word from the middle/end of the command
  let cmd = kb;

  // Strip exact domain or singular from end: "get-contacts" → "get", "list-contact-tags" → "list-tags"
  const stripPatterns = [domainKb, singularAlt, singular];
  for (const pat of stripPatterns) {
    // Remove "-<domain>" suffix
    const suffixRe = new RegExp(`-${pat.replace(/-/g, '[-_]?')}(-|$)`, 'i');
    const candidate = cmd.replace(suffixRe, '$1').replace(/-$/, '');
    if (candidate && candidate !== cmd) {
      cmd = candidate;
      break;
    }
    // Remove "<domain>-" prefix
    const prefixRe = new RegExp(`^${pat.replace(/-/g, '[-_]?')}-`, 'i');
    const candidate2 = cmd.replace(prefixRe, '');
    if (candidate2 && candidate2 !== cmd) {
      cmd = candidate2;
      break;
    }
  }

  // Map verbose verbs to short forms
  const verbMap: Record<string, string> = {
    'search-advanced': 'search',
    'get-all': 'list',
    'get-list': 'list',
    'list-all': 'list',
    'get-by-id': 'get',
    'get-one': 'get',
    'create-new': 'create',
    'add-new': 'add',
    'delete-by-id': 'delete',
    'remove-by-id': 'remove',
    'update-by-id': 'update',
  };
  if (verbMap[cmd]) cmd = verbMap[cmd] ?? cmd;

  return cmd || kb;
}

// ---------------------------------------------------------------------------
// $ref resolver
// ---------------------------------------------------------------------------

/**
 * Resolve a local `$ref` string within a spec file.
 * Handles:
 *   "#/components/schemas/Foo"          → local schema
 *   "common-schemas.json#/..."          → _common-schemas.json
 *   "./common-schemas.json#/..."        → _common-schemas.json
 */
function resolveRef(
  ref: string,
  localSchemas: Record<string, JsonSchema>,
  commonSchemas: Record<string, JsonSchema>,
): JsonSchema | null {
  if (ref.startsWith('#/components/schemas/')) {
    const name = ref.slice('#/components/schemas/'.length);
    return localSchemas[name] ?? null;
  }

  const commonPrefixes = ['common-schemas.json#', './common-schemas.json#'];
  for (const prefix of commonPrefixes) {
    if (ref.startsWith(prefix)) {
      const rest = ref.slice(prefix.length);
      if (rest.startsWith('/components/schemas/')) {
        const name = rest.slice('/components/schemas/'.length);
        return commonSchemas[name] ?? null;
      }
    }
  }

  return null; // external or unrecognised — can't resolve
}

/**
 * Recursively resolve a schema, following `$ref`s up to a depth limit.
 * Returns the resolved schema or null if unresolvable.
 */
function resolveSchema(
  schema: JsonSchema,
  localSchemas: Record<string, JsonSchema>,
  commonSchemas: Record<string, JsonSchema>,
  depth = 0,
): JsonSchema | null {
  if (depth > 5) return null;

  if ('$ref' in schema && typeof schema.$ref === 'string') {
    const resolved = resolveRef(schema.$ref, localSchemas, commonSchemas);
    if (!resolved) return null;
    return resolveSchema(resolved, localSchemas, commonSchemas, depth + 1);
  }

  return schema;
}

// ---------------------------------------------------------------------------
// Body field extraction
// ---------------------------------------------------------------------------

interface BodyAnalysis {
  bodyFields: OpBodyField[];
  bodyIsOpen: boolean;
}

const BODY_FIELD_CAP = 40;

function extractBodyFields(
  rawSchema: JsonSchema,
  localSchemas: Record<string, JsonSchema>,
  commonSchemas: Record<string, JsonSchema>,
): BodyAnalysis {
  const schema = resolveSchema(rawSchema, localSchemas, commonSchemas);

  if (!schema) {
    return { bodyFields: [], bodyIsOpen: true };
  }

  // allOf: merge properties and required lists
  if (Array.isArray(schema.allOf)) {
    const mergedProps: Record<string, JsonSchema> = {};
    const mergedRequired: string[] = [];

    for (const part of schema.allOf as JsonSchema[]) {
      const resolved = resolveSchema(part, localSchemas, commonSchemas);
      if (!resolved) continue;
      const props = resolved.properties as Record<string, JsonSchema> | undefined;
      const req = resolved.required as string[] | undefined;
      if (props) Object.assign(mergedProps, props);
      if (req) mergedRequired.push(...req);
    }

    if (Object.keys(mergedProps).length === 0) {
      return { bodyFields: [], bodyIsOpen: true };
    }

    return buildFieldsFromProps(mergedProps, mergedRequired);
  }

  // Plain object with properties
  if (schema.type === 'object' || schema.properties) {
    const props = schema.properties as Record<string, JsonSchema> | undefined;
    const req = schema.required as string[] | undefined;

    if (!props || Object.keys(props).length === 0) {
      // additionalProperties or empty object
      return { bodyFields: [], bodyIsOpen: true };
    }

    return buildFieldsFromProps(props, req ?? []);
  }

  // Array or other non-object schema at the top level
  return { bodyFields: [], bodyIsOpen: true };
}

function buildFieldsFromProps(props: Record<string, JsonSchema>, required: string[]): BodyAnalysis {
  const requiredSet = new Set(required);
  const allNames = Object.keys(props);

  let truncated = false;
  let names = allNames;

  if (allNames.length > BODY_FIELD_CAP) {
    truncated = true;
    // required first, then fill up to cap
    const reqFirst = allNames.filter((n) => requiredSet.has(n));
    const rest = allNames.filter((n) => !requiredSet.has(n));
    names = [...reqFirst, ...rest].slice(0, BODY_FIELD_CAP);
  }

  const bodyFields: OpBodyField[] = names.map((name) => {
    const prop = props[name] ?? {};
    const type = typeof prop.type === 'string' ? prop.type : ('object' as string);
    const description = typeof prop.description === 'string' ? prop.description : undefined;
    const enumVals = Array.isArray(prop.enum) ? (prop.enum as unknown[]).map(String) : undefined;

    return {
      name,
      required: requiredSet.has(name),
      type,
      ...(description !== undefined ? { description } : {}),
      ...(enumVals !== undefined ? { enum: enumVals } : {}),
    };
  });

  return { bodyFields, bodyIsOpen: truncated };
}

// ---------------------------------------------------------------------------
// Parameter extraction
// ---------------------------------------------------------------------------

function extractOpParam(param: OpenApiParam): OpParam {
  const schema = (param.schema ?? {}) as JsonSchema;
  const rawType = typeof schema.type === 'string' ? schema.type : 'string';

  // Normalise to the union in OpParam
  const typeMap: Record<string, OpParam['type']> = {
    string: 'string',
    number: 'number',
    integer: 'integer',
    boolean: 'boolean',
    array: 'array',
    object: 'object',
  };
  const type: OpParam['type'] = typeMap[rawType] ?? 'string';

  const enumVals = Array.isArray(schema.enum) ? (schema.enum as unknown[]).map(String) : undefined;

  const itemsType =
    type === 'array' && schema.items && typeof (schema.items as JsonSchema).type === 'string'
      ? ((schema.items as JsonSchema).type as string)
      : undefined;

  const defaultVal = schema.default as string | number | boolean | undefined;

  return {
    name: param.name,
    in: param.in as OpParam['in'],
    required: param.required ?? false,
    type,
    ...(param.description ? { description: param.description } : {}),
    ...(enumVals ? { enum: enumVals } : {}),
    ...(itemsType ? { itemsType } : {}),
    ...(defaultVal !== undefined ? { default: defaultVal } : {}),
  };
}

// ---------------------------------------------------------------------------
// Version resolution
// ---------------------------------------------------------------------------

function resolveVersion(params: OpenApiParam[]): string {
  const vp = params.find((p) => p.in === 'header' && p.name === 'Version');
  if (!vp) return DEFAULT_VERSION;

  const schema = (vp.schema ?? {}) as JsonSchema;
  const enumVals = Array.isArray(schema.enum) ? (schema.enum as unknown[]).map(String) : [];
  const defaultVal = typeof schema.default === 'string' ? schema.default : null;

  if (enumVals.length === 1) return enumVals[0]!;
  if (enumVals.includes('2021-07-28')) return '2021-07-28';
  if (enumVals.length > 0) return enumVals[0]!;
  if (defaultVal) return defaultVal;

  return DEFAULT_VERSION;
}

// ---------------------------------------------------------------------------
// Synthesise operationId from method + path
// ---------------------------------------------------------------------------

function synthesiseId(method: string, path: string): string {
  // e.g. GET /contacts/{contactId}/tags → get-contacts-by-contactid-tags
  const segments = path
    .split('/')
    .filter(Boolean)
    .map((seg) => {
      if (seg.startsWith('{') && seg.endsWith('}')) {
        return `by-${toKebab(seg.slice(1, -1))}`;
      }
      return toKebab(seg);
    });
  return `${method}-${segments.join('-')}`;
}

// ---------------------------------------------------------------------------
// Summary of stats for reporting
// ---------------------------------------------------------------------------

interface GenStats {
  specsProcessed: number;
  specFiles: string[];
  totalOps: number;
  perDomain: Record<string, number>;
  idCollisions: string[];
  commandCollisions: string[];
  unresolvedRefs: string[];
  emptyBodyFields: number;
  bodyIsOpenCount: number;
}

// ---------------------------------------------------------------------------
// Main generator
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const stats: GenStats = {
    specsProcessed: 0,
    specFiles: [],
    totalOps: 0,
    perDomain: {},
    idCollisions: [],
    commandCollisions: [],
    unresolvedRefs: [],
    emptyBodyFields: 0,
    bodyIsOpenCount: 0,
  };

  // Load common schemas
  const commonSpecPath = join(SPEC_DIR, '_common-schemas.json');
  const commonSpec = JSON.parse(readFileSync(commonSpecPath, 'utf8')) as OpenApiSpec;
  const commonSchemas = commonSpec.components?.schemas ?? {};

  // Collect spec files (skip _ prefix)
  const specFiles = readdirSync(SPEC_DIR)
    .filter((f) => !f.startsWith('_') && f.endsWith('.json'))
    .sort();

  stats.specFiles = specFiles;
  stats.specsProcessed = specFiles.length;

  // Phase 1: collect all raw operations with domain info
  type RawOp = {
    id: string;
    domain: string;
    method: string;
    path: string;
    op: OpenApiOperation;
    localSchemas: Record<string, JsonSchema>;
  };

  const rawOps: RawOp[] = [];
  const seenIds = new Map<string, number>(); // id → count

  for (const specFile of specFiles) {
    const domain = specFile.replace(/\.json$/, '');
    const spec = JSON.parse(readFileSync(join(SPEC_DIR, specFile), 'utf8')) as OpenApiSpec;
    const localSchemas = spec.components?.schemas ?? {};

    for (const [path, methods] of Object.entries(spec.paths ?? {})) {
      for (const [method, op] of Object.entries(methods)) {
        if (!ALLOWED_METHODS.has(method)) continue;

        // Resolve operationId (synthesise if missing)
        let id = op.operationId ?? synthesiseId(method, path);
        id = toKebab(id);

        // Ensure global uniqueness
        const existingCount = seenIds.get(id) ?? 0;
        if (existingCount > 0) {
          const collisionId = id;
          // First try appending domain
          const withDomain = `${id}-${toKebab(domain)}`;
          if (!seenIds.has(withDomain)) {
            id = withDomain;
            stats.idCollisions.push(`${collisionId} → ${id}`);
          } else {
            // Append numeric suffix
            let suffix = 2;
            while (seenIds.has(`${collisionId}-${suffix}`)) suffix++;
            id = `${collisionId}-${suffix}`;
            stats.idCollisions.push(`${collisionId} → ${id}`);
          }
        }

        seenIds.set(id, (seenIds.get(id) ?? 0) + 1);

        rawOps.push({ id, domain, method, path, op, localSchemas });
      }
    }
  }

  // Phase 2: derive commands, dedupe within domain
  // domain → command → count
  const domainCommandSeen = new Map<string, Map<string, number>>();

  const operations: Operation[] = rawOps.map((raw) => {
    const { id, domain, method, path, op, localSchemas } = raw;

    // Derive command from operationId
    let command = deriveCommand(id, domain);

    // Dedupe within domain
    if (!domainCommandSeen.has(domain)) {
      domainCommandSeen.set(domain, new Map());
    }
    const domainCmds = domainCommandSeen.get(domain)!;
    const cmdCount = domainCmds.get(command) ?? 0;

    if (cmdCount > 0) {
      // Fall back to full kebab operationId
      const fullKebab = toKebab(id);
      const fullKebabCount = domainCmds.get(fullKebab) ?? 0;
      stats.commandCollisions.push(`${domain}/${command} → ${fullKebab}`);
      command = fullKebab;

      if (fullKebabCount > 0) {
        // Still collides — suffix with number
        let suffix = 2;
        while (domainCmds.has(`${fullKebab}-${suffix}`)) suffix++;
        command = `${fullKebab}-${suffix}`;
        stats.commandCollisions.push(`${domain}/${fullKebab} → ${command}`);
      }
    }

    domainCmds.set(command, (domainCmds.get(command) ?? 0) + 1);

    // Parameters
    const allParams: OpenApiParam[] = op.parameters ?? [];

    // Path params: ordered by template order
    const pathParamOrder = extractPathParamNames(path);
    const pathParamsRaw = allParams.filter((p) => p.in === 'path');
    // Sort by template order
    const pathParams: OpParam[] = pathParamOrder.map((name) => {
      const found = pathParamsRaw.find((p) => p.name === name);
      if (!found) {
        // synthesise minimal param
        return { name, in: 'path', required: true, type: 'string' as const };
      }
      const extracted = extractOpParam(found);
      return { ...extracted, required: true };
    });

    const queryParams: OpParam[] = allParams.filter((p) => p.in === 'query').map(extractOpParam);

    const headerParams: OpParam[] = allParams
      .filter((p) => p.in === 'header' && p.name !== 'Authorization')
      .map(extractOpParam);

    const version = resolveVersion(allParams);

    // Body
    let hasBody = false;
    let bodyFields: OpBodyField[] = [];
    let bodyIsOpen = false;

    if (op.requestBody) {
      hasBody = true;
      const bodySchema = op.requestBody.content?.['application/json']?.schema;

      if (bodySchema) {
        // Check for unresolved $ref
        if ('$ref' in bodySchema && typeof bodySchema.$ref === 'string') {
          const refStr = bodySchema.$ref as string;
          if (refStr.startsWith('#/components/schemas/')) {
            const schemaName = refStr.slice('#/components/schemas/'.length);
            if (!localSchemas[schemaName]) {
              stats.unresolvedRefs.push(`${domain}: ${refStr}`);
              bodyIsOpen = true;
            }
          }
        }

        if (!bodyIsOpen) {
          const analysis = extractBodyFields(bodySchema, localSchemas, commonSchemas);
          bodyFields = analysis.bodyFields;
          bodyIsOpen = analysis.bodyIsOpen;
        }
      } else {
        bodyIsOpen = true;
      }
    }

    if (hasBody && bodyFields.length === 0) stats.emptyBodyFields++;
    if (bodyIsOpen) stats.bodyIsOpenCount++;

    // Scopes
    const scopes: string[] = [];
    for (const secEntry of op.security ?? []) {
      for (const vals of Object.values(secEntry)) {
        scopes.push(...vals);
      }
    }
    const uniqueScopes = [...new Set(scopes)];

    // Summary / description — strip ClickUp noise
    const rawSummary = op.summary ?? '';
    const rawDescription = op.description ?? op.summary ?? '';

    // Extract docsUrl from externalDocs or strip from description
    let docsUrl: string | undefined = op.externalDocs?.url;
    let description = rawDescription;

    // Strip common "Documentation Link - https://..." pattern
    const docLinkRe = /\s*Documentation Link\s*[-–]\s*https?:\/\/\S+/gi;
    if (!docsUrl) {
      const match = rawDescription.match(/https?:\/\/\S+/);
      if (docLinkRe.test(rawDescription) && match) {
        docsUrl = match[0];
        description = rawDescription.replace(docLinkRe, '').trim();
      }
    } else {
      description = rawDescription.replace(docLinkRe, '').trim();
    }

    // Update domain stats
    stats.perDomain[domain] = (stats.perDomain[domain] ?? 0) + 1;
    stats.totalOps++;

    const operation: Operation = {
      id,
      domain,
      command,
      method: method as Operation['method'],
      path,
      pathParams,
      queryParams,
      headerParams,
      hasBody,
      bodyFields,
      bodyIsOpen,
      version,
      scopes: uniqueScopes,
      summary: rawSummary,
      description,
      tags: op.tags ?? [],
      ...(docsUrl ? { docsUrl } : {}),
    };

    return operation;
  });

  // Sort by domain then command (deterministic)
  operations.sort((a, b) => {
    const d = a.domain.localeCompare(b.domain);
    return d !== 0 ? d : a.command.localeCompare(b.command);
  });

  // ---------------------------------------------------------------------------
  // Write output
  // ---------------------------------------------------------------------------

  const specFilesList = JSON.stringify(specFiles, null, 2);

  // Serialise the operations array as pretty JSON embedded in TS
  const opsJson = JSON.stringify(operations, null, 2);

  // Deterministic digest of the generated operations (NOT a wall-clock timestamp) — so
  // re-running `pnpm gen` on unchanged specs produces a byte-identical file (CI relies on this).
  const generatedAt = createHash('sha256').update(opsJson).digest('hex').slice(0, 12);

  const output = [
    '// AUTO-GENERATED by scripts/gen.ts from spec/*.json — DO NOT EDIT BY HAND. Run `pnpm gen`.',
    '// `GENERATED_AT` is a content digest of the operations below, not a timestamp (kept deterministic for CI).',
    "import type { Operation } from '../types.js';",
    '',
    `export const OPERATIONS: Operation[] = ${opsJson};`,
    '',
    `export const GENERATED_AT = '${generatedAt}';`,
    '',
    `export const SPEC_FILES: string[] = ${specFilesList};`,
    '',
  ].join('\n');

  writeFileSync(OUT_FILE, output, 'utf8');

  // ---------------------------------------------------------------------------
  // Summary report
  // ---------------------------------------------------------------------------

  console.log('\n=== ghl-cli codegen complete ===\n');
  console.log(`Specs processed    : ${stats.specsProcessed}`);
  console.log(`Total operations   : ${stats.totalOps}`);
  console.log(`Output             : ${OUT_FILE}`);
  console.log(`Generated at       : ${generatedAt}`);

  console.log('\nPer-domain operation counts:');
  const sortedDomains = Object.entries(stats.perDomain).sort(([a], [b]) => a.localeCompare(b));
  for (const [domain, count] of sortedDomains) {
    console.log(`  ${domain.padEnd(30)} ${count}`);
  }

  console.log(`\nEmpty bodyFields ops         : ${stats.emptyBodyFields}`);
  console.log(`bodyIsOpen ops               : ${stats.bodyIsOpenCount}`);

  if (stats.unresolvedRefs.length > 0) {
    console.log(`\nUnresolved $refs (${stats.unresolvedRefs.length}):`);
    for (const r of stats.unresolvedRefs) console.log(`  ${r}`);
  } else {
    console.log('\nUnresolved $refs             : 0');
  }

  if (stats.idCollisions.length > 0) {
    console.log(`\nID collisions disambiguated (${stats.idCollisions.length}):`);
    for (const c of stats.idCollisions) console.log(`  ${c}`);
  } else {
    console.log('ID collisions                : 0');
  }

  if (stats.commandCollisions.length > 0) {
    console.log(`\nCommand collisions fixed (${stats.commandCollisions.length}):`);
    for (const c of stats.commandCollisions) console.log(`  ${c}`);
  } else {
    console.log('Command collisions           : 0');
  }

  console.log('\n=== done ===\n');
}

await main();
