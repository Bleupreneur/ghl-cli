# Contributing to ghl-cli

---

## The core rule

`src/generated/operations.ts` is auto-generated. **Never hand-edit it.** If a command name is wrong, a description is missing, or a parameter is mis-typed, fix the heuristic in `scripts/gen.ts` (or the upstream spec) and re-run `pnpm gen`. Manual edits will be overwritten on the next codegen run.

---

## Refreshing specs

The `spec/` directory contains vendored copies of the official GoHighLevel OpenAPI specs from [`GoHighLevel/highlevel-api-docs`](https://github.com/GoHighLevel/highlevel-api-docs).

To pull the latest version:

```bash
pnpm sync-specs   # runs scripts/sync-specs.sh — git-pulls the docs repo, copies apps/*.json → spec/
```

This updates the 41 JSON files in `spec/`. After refreshing:

```bash
pnpm gen          # re-parse specs → src/generated/operations.ts
pnpm typecheck    # ensure nothing broke
pnpm test         # ensure no regressions
```

The weekly `sync-specs.yml` GitHub Actions workflow does this automatically and opens a PR if anything changed.

---

## Regenerating operations

```bash
pnpm gen
```

This runs `scripts/gen.ts` (via `tsx`), which:
1. Reads all `spec/*.json` files (skipping `_common-schemas.json`).
2. Resolves `$ref`s within each spec.
3. For each path + method, extracts: `operationId`, domain (file basename), path/query/header params, body fields, `Version` header value, OAuth scopes, summary, description, docs URL.
4. Derives a CLI command name from the `operationId` (snake-case → kebab-case, domain prefix stripped).
5. Deduplicates command names within each domain (appends suffix if needed).
6. Emits `src/generated/operations.ts` — a const-typed `Operation[]` export.

If codegen produces a bad command name (e.g. too long, stripped wrong prefix, conflicts with a built-in command), fix the normalization heuristic in `scripts/gen.ts`. Do not patch `operations.ts` directly.

---

## Adding a new spec

If GHL adds a new API domain:

1. Add the spec JSON to `spec/<domain>.json`.
2. Run `pnpm gen`.
3. The new domain and all its commands appear automatically.
4. Run `pnpm typecheck && pnpm test && pnpm lint`.
5. If any tests check the operation count or domain list, update them.

---

## Adding or modifying the runtime

The runtime is in `src/` (all files except `src/generated/` and `src/commands/`). These are generic — they handle any `Operation` the same way.

Key files:

| File | What to touch | When |
|------|--------------|------|
| `src/http.ts` | Request building, auth headers, retry logic | HTTP layer bugs or new header requirements |
| `src/auth.ts` | Credential resolution chain | New auth kind or resolution order change |
| `src/config.ts` | Config file read/write | New profile fields (`CliConfig`, `Profile` shape changes) |
| `src/params.ts` | CLI arg → request mapping | Body/query/path mapping bugs |
| `src/output.ts` | Output formatting | New output format or exit code |
| `src/buildCommands.ts` | Commander tree construction | Command registration bugs |

When modifying any of these, update or add tests in `test/` and run `pnpm test`.

---

## Adding hand-written commands

Only for commands that are not GHL API operations: `auth`, `raw`, `search`, `docs`, and `version`.

These live in `src/commands/`. Adding a new built-in command:

1. Create `src/commands/<name>.ts` — export a `Command` (or factory function returning a `Command`) from Commander.
2. Mount it in `src/cli.ts`.
3. Add tests in `test/`.
4. Document it in `docs/usage.md`.

Avoid adding hand-written commands for things that are already in the OpenAPI specs — that is what codegen is for.

---

## Running checks

Before committing:

```bash
pnpm typecheck    # tsc --noEmit — zero errors required
pnpm test         # vitest run — all tests must pass
pnpm lint         # biome check — zero warnings required
```

All three in one:

```bash
pnpm typecheck && pnpm test && pnpm lint
```

CI runs the same checks on every push and PR.

---

## Writing tests

Tests live in `test/` (or colocated as `*.test.ts`). Framework: Vitest.

Key test areas:
- **Codegen validity** (`test/gen.test.ts`): no duplicate command names across all operations, all operations have a domain and command, no missing required fields.
- **Params** (`test/params.test.ts`): path interpolation, query string construction, body field mapping, `--set k=v` parsing, `--data @file` expansion.
- **Config** (`test/config.test.ts`): read profiles, write profiles, delete profiles, chmod 600.
- **Auth** (`test/auth.test.ts`): resolution order (flags > env > profile > default > error).
- **Output** (`test/output.test.ts`): JSON vs. table vs. quiet, error to stderr, exit codes.
- **HTTP** (`test/http.test.ts`): auth headers present, Version header correct, timeout, 429 retry, error parsing.

For HTTP tests, mock `fetch` — do not make real GHL API calls in unit tests.

Integration smoke tests (real API calls) are gated behind an env var (e.g. `GHL_INTEGRATION_TEST=1`) and are not run in CI by default.

---

## Commit conventions

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add --dry-run flag to write commands
fix: correct Version header for calendar-events endpoints
chore: sync GHL OpenAPI specs (2026-05-19)
docs: add recipes for payments
test: add params.test.ts coverage for --set with dotted keys
```

Types: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`, `ci`.

---

## Secrets

Never put secrets in source code. Credentials live only in `~/.config/ghl/config.json` (chmod 600) and in CI secrets. If a token ever appears in a committed file, rotate it immediately.

---

## Building

```bash
pnpm build
```

This runs `tsup` to produce `dist/cli.js` (ESM, targeting Node 22). The `ghl` bin entry in `package.json` points here.

Smoke test the build:

```bash
node dist/cli.js --help
node dist/cli.js contacts --help
node dist/cli.js version
```

---

## Publishing

Publishing to npm is maintainer-only. The `prepublishOnly` script runs `gen → typecheck → test → build` before `npm publish` to ensure the published package is always up-to-date and passing.

```bash
pnpm version patch   # or minor, major
pnpm publish --access public
```

The `spec/` directory is included in the published package (listed in `files` in `package.json`) so `pnpm sync-specs` + `pnpm gen` can be run from an installed package.
