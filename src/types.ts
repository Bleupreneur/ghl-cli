/**
 * Core type contracts for ghl-cli.
 *
 * The whole CLI is generic: `scripts/gen.ts` reads the official GoHighLevel OpenAPI
 * specs in `spec/*.json` and emits `src/generated/operations.ts` — a flat list of
 * `Operation` records. `src/buildCommands.ts` turns each `Operation` into a Commander
 * subcommand. The runtime (`http.ts`, `params.ts`, `auth.ts`, `output.ts`) is fully
 * data-driven from these records, so adding GHL endpoints = re-run `pnpm gen`, nothing else.
 */

export type HttpMethod = 'get' | 'post' | 'put' | 'delete' | 'patch';

/** A parameter on an operation, derived from an OpenAPI `parameters` entry. */
export interface OpParam {
  /** OpenAPI parameter name, e.g. `locationId`, `contactId`, `limit`, `Version`. */
  name: string;
  in: 'path' | 'query' | 'header';
  required: boolean;
  type: 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object';
  description?: string;
  enum?: string[];
  /** For `type: 'array'`, the item primitive type. */
  itemsType?: string;
  /** Default value from the spec (e.g. the first/only value of a `Version` header enum). */
  default?: string | number | boolean;
}

/** A documented top-level property of a JSON request body. Best-effort — may be empty. */
export interface OpBodyField {
  name: string;
  required: boolean;
  type: string;
  description?: string;
  enum?: string[];
}

/** One GHL API operation == one CLI command (`ghl <domain> <command>`). */
export interface Operation {
  /** OpenAPI `operationId`, e.g. `search-contacts-advanced`. Unique across all specs. */
  id: string;
  /** Source spec domain (file basename), e.g. `contacts`, `calendars`, `social-media-posting`. */
  domain: string;
  /** Command name within the domain, e.g. `search`. Full path = `ghl <domain> <command>`. */
  command: string;
  method: HttpMethod;
  /** Path template, e.g. `/contacts/{contactId}/tags`. */
  path: string;
  /** Path params, in template order — rendered as positional CLI args. */
  pathParams: OpParam[];
  /** Query params — rendered as `--flags`. */
  queryParams: OpParam[];
  /** Header params other than `Authorization` (mainly `Version`). */
  headerParams: OpParam[];
  /** Does this operation send a JSON request body? */
  hasBody: boolean;
  /** Documented top-level body fields. Rendered as `--flags`; may be empty for opaque bodies. */
  bodyFields: OpBodyField[];
  /** True if the body schema is open/unknown — accept arbitrary `--set k=v` / `--data` then. */
  bodyIsOpen: boolean;
  /** API version header value to send (resolved from the spec), e.g. `2021-07-28` / `2021-04-15`. */
  version: string;
  /** OAuth scopes the endpoint requires (informational; PIT tokens carry their own scopes). */
  scopes: string[];
  /** One-line summary — shown in `ghl <domain> --help` and `ghl search`. */
  summary: string;
  /** Longer description — shown in `ghl <domain> <command> --help`. */
  description: string;
  /** External docs URL, if the spec provides one. */
  docsUrl?: string;
  /** OpenAPI tags (informational). */
  tags: string[];
}

/** A saved credential profile in `~/.config/ghl/config.json`. */
export interface Profile {
  name: string;
  /** Private Integration Token, sent as `Authorization: Bearer <apiKey>`. */
  apiKey?: string;
  /** Default `locationId` (a.k.a. `altId`) injected into operations that accept one. */
  locationId?: string;
  /** `pit` = Private Integration Token (sub-account), `agency` = agency-level API key. */
  kind?: 'pit' | 'agency';
}

export interface CliConfig {
  /** Name of the default profile (used when no `--profile` / `GHL_PROFILE`). */
  default?: string;
  profiles: Record<string, Profile>;
}

/** Auth resolved for one command invocation (flags > env > profile chain). */
export interface AuthContext {
  apiKey: string;
  locationId?: string;
  profileName?: string;
}

export type OutputFormat = 'json' | 'pretty' | 'table';

/** Thrown by the HTTP layer on a non-2xx GHL response. */
export class GhlApiError extends Error {
  constructor(
    public status: number,
    public statusText: string,
    public body: unknown,
    public method: string,
    public url: string,
  ) {
    super(
      `GHL API ${status} ${statusText} on ${method} ${url}` +
        (body ? `\n${typeof body === 'string' ? body : JSON.stringify(body, null, 2)}` : ''),
    );
    this.name = 'GhlApiError';
  }
}

/** Thrown for bad CLI usage (missing required arg, unknown profile, etc.). Exit code 2. */
export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

export const BASE_URL = 'https://services.leadconnectorhq.com';
export const DEFAULT_VERSION = '2021-07-28';
