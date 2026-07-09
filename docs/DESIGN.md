# ghl-cli — Design

> Status: building (v0.1). Owner: Dr. Lead Flow. Created 2026-05-12.

## Why this exists

The team runs a GoHighLevel MCP server with ~500 tools. Every MCP client (Claude, team
members) loads all ~500 tool schemas into context on every session ≈ **80–100K tokens before
any work happens** — ~40–50% of a 200K context window, paid every connection.

A CLI is **one Bash tool**. Idle context cost ≈ **0**. An agent discovers what it needs on
demand: `ghl --help` → `ghl <domain> --help` → `ghl <domain> <command> --help` (a few hundred
tokens each), then runs the command. A 10-step task costs ~2–6K tokens of overhead instead of
~100K. Same capability, ~95% less context tax.

This repo is **fully standalone** — it does not depend on the MCP server repo or worker. It
shares nothing with them by design (so each can evolve independently).

## Source of truth

`spec/*.json` — the 41 official GoHighLevel API v2 OpenAPI 3.0 specs, vendored verbatim from
[`GoHighLevel/highlevel-api-docs`](https://github.com/GoHighLevel/highlevel-api-docs) (`apps/`).
~576 operations total. Refresh with `pnpm sync-specs` (git-pulls the docs repo, copies the
JSON), then `pnpm gen` to rebuild the generated layer.

## Architecture (data-driven, generic)

```
spec/*.json                         official OpenAPI specs (vendored, ~576 operations)
  │  scripts/gen.ts  (pnpm gen)
  ▼
src/generated/operations.ts         flat Operation[] — id, domain, command, method, path,
                                    path/query/header params, body fields, version header,
                                    scopes, summary, description.  CHECKED IN.
  │  src/buildCommands.ts
  ▼
Commander command tree              ghl <domain> <command> [positionals] [--flags]
  │  src/params.ts  →  src/http.ts  →  GHL API
  ▼
src/output.ts                       JSON (piped) / table (TTY) / -q / --pretty ; errors→stderr
```

Adding GHL endpoints later = `pnpm sync-specs && pnpm gen && pnpm test` — no hand-written
command code changes.

## Files

| Path | Role |
|---|---|
| `spec/*.json` | Vendored OpenAPI specs (the source of truth) |
| `scripts/sync-specs.sh` | git-pull `highlevel-api-docs`, copy `apps/*.json` → `spec/` |
| `scripts/gen.ts` | Parse `spec/*.json` (resolve `$ref`s, pick `Version` per op) → `src/generated/operations.ts` |
| `src/types.ts` | `Operation`, `Profile`, `CliConfig`, `AuthContext`, `GhlApiError`, `UsageError`, constants |
| `src/generated/operations.ts` | Generated `Operation[]` (do not edit) |
| `src/http.ts` | `fetch` wrapper — base URL, `Bearer` auth, `Version` header, timeout, retry, error parsing |
| `src/config.ts` | Read/write `~/.config/ghl/config.json` (named profiles, `default` pointer, chmod 600) |
| `src/auth.ts` | Resolve auth: `--api-key`+`--location` ▸ `GHL_API_KEY`+`GHL_LOCATION_ID` ▸ `--profile` ▸ `GHL_PROFILE` ▸ default profile ▸ friendly error |
| `src/params.ts` | Map CLI args → request: path params (positionals), query params (`--flag`), body (`--set k=v` / `--data '<json>'` / `--data @file` / generated `--field` flags); auto-inject `locationId`/`altId` |
| `src/output.ts` | Format result — JSON to stdout (piped/non-TTY default), table (TTY default), `--json`/`--pretty`/`-q`; errors → stderr; exit 0 ok / 1 API error / 2 usage error |
| `src/buildCommands.ts` | Turn `OPERATIONS` into the Commander tree (one command per operation) |
| `src/cli.ts` | Entry point — mount generated tree + hand-written commands; the `bin: ghl` target |
| `src/commands/auth.ts` | `ghl auth add\|list\|use\|whoami\|rm` |
| `src/commands/raw.ts` | `ghl raw <GET\|POST\|PUT\|DELETE\|PATCH> <path> [--query k=v] [--data ...]` — escape hatch, any endpoint |
| `src/commands/search.ts` | `ghl search <keyword>` — find operations by name/summary without loading every `--help` |
| `test/*.test.ts` | Vitest — codegen validity (no dup command names, all ops mapped), http request building (mocked), config CRUD, auth chain, output modes, params parsing, raw builder; env-gated integration smoke |
| `.github/workflows/ci.yml` | typecheck + lint + test on PR/push |
| `.github/workflows/sync-specs.yml` | weekly: `sync-specs` + `gen` + open PR if specs changed |
| `.claude/skills/ghl-cli/SKILL.md` | Skill so Claude Code agents know how to drive the CLI |
| `CLAUDE.md` | Repo guidance for AI agents working *in* this repo |
| `README.md` | User-facing: install, auth setup, command reference, examples |
| `docs/*` | `DESIGN.md` (this), `usage.md`, `agent-guide.md`, `recipes.md`, `contributing.md` |

## Auth model

- Credentials live in `~/.config/ghl/config.json` (chmod 600), as **named profiles**:
  `{ default: "work", profiles: { work: { name, apiKey, locationId, kind: "pit" }, ... } }`.
- Supported credential kinds: **Private Integration Tokens** (`kind: "pit"`, the normal case) and
  agency API keys (`kind: "agency"`). Both are static bearer tokens the user pastes in — the CLI
  never mints, refreshes, or rotates a credential.
- `ghl auth add --name <n> --api-key <key> --location <id>` writes a profile;
  `ghl auth use <n>` sets the default; `ghl auth list` shows them with keys redacted.
- Resolution order per command: `--api-key`+`--location` flags → `GHL_API_KEY`+`GHL_LOCATION_ID`
  env → `--profile <n>` → `GHL_PROFILE` env → `default` profile → friendly error pointing to `ghl auth add`.
- The CLI never prints or logs full tokens.

**Deliberately out of scope.** No Marketplace OAuth flow (no client id/secret, no callback server,
no refresh tokens) and no token broker. Both would drag a hosted service, a redirect URI, and a
credential-rotation story into what is otherwise a static-token CLI you can read end to end.
An agency that needs to fan one authorization across many sub-accounts should put a token-minting
service *in front of* this CLI and feed it a PIT per invocation — that keeps the trust boundary
outside the binary users run on their laptops.

## Output & exit codes

- stdout: JSON when piped / non-TTY (clean for `jq`); compact table when a TTY; `--json` / `--pretty` force; `-q` prints just the data payload.
- stderr: errors only (human-readable: HTTP status + GHL error body, or usage hint).
- exit: `0` success · `1` GHL API error · `2` CLI usage error.

## Out of scope (v1)

GHL internal/private APIs (site-builder, workflow-builder — Firebase auth, separate workers) ·
team-shared credential sync ·  bun-compiled standalone binaries (v1.1) · slim-MCP rebuild (separate project).

## Token math

| | Idle | Discovery | 10-step task overhead |
|---|---|---|---|
| MCP (~500 tools) | ~80–100K | — | ~80–100K |
| `ghl` CLI | ~0 (one Bash tool) | `ghl --help` ~300 · `ghl <domain> --help` ~500–900 · `ghl <cmd> --help` ~200–500 · `ghl search` ~150 | ~2–6K |
