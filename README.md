# ghl-cli

**Token-light GoHighLevel CLI — the full v2 API as shell commands, generated from the official OpenAPI specs. Built for AI agents and power users.**

`@bleupreneur/ghl-cli` · Node 22+ · MIT · 576 operations across 41 domains

---

## Why this exists

A GoHighLevel MCP server exposes ~500 tools, and every MCP client loads all ~500 tool schemas into context on connection — **80–100K tokens before any work happens.** On a 200K context window that is 40–50%, paid every session whether you use one tool or none.

A CLI is **one Bash tool.** Idle context cost is approximately zero, and an agent discovers what it needs on demand:

```bash
ghl --help                           # ~300 tokens — lists 41 domains
ghl contacts --help                  # ~600 tokens — lists every contacts command
ghl contacts search --help           # ~300 tokens — flags for one operation
ghl contacts search --email j@x.com  # runs it
```

A ten-step task costs roughly 2–6K tokens of overhead instead of ~100K. Same full API surface, about 95% less context tax.

---

## Install

**From npm:**

```bash
npm install -g @bleupreneur/ghl-cli
```

**From source:**

```bash
git clone https://github.com/bleupreneur/ghl-cli.git
cd ghl-cli
pnpm install && pnpm build
pnpm link --global
```

**Run without installing:**

```bash
pnpm dev contacts --help
```

Requires **Node 22 or later.**

---

## Setup

The CLI authenticates with a **Private Integration Token** (PIT). Nothing else — no OAuth app, no callback server, no broker.

### 1. Create a Private Integration Token

In GoHighLevel: **Settings → Private Integrations → Create new integration.**

Select the scopes you need (a token only carries the scopes you tick — if a command later returns `401`/`403`, a missing scope is the usual reason), then copy the token. It looks like `pit-0a1b2c3d-...`.

### 2. Find your Location ID

Your sub-account's Location ID is in the browser URL while you are inside that sub-account:

```
https://app.gohighlevel.com/v2/location/<THIS_IS_YOUR_LOCATION_ID>/dashboard
```

It is also shown under **Settings → Business Profile.**

### 3. Save a profile

```bash
ghl auth add --name work --api-key pit-0a1b2c3d-... --location abc123XYZ --default
```

That writes `~/.config/ghl/config.json` with mode `600` (owner-only). The CLI never prints a full token — `auth list` and `auth whoami` redact it.

### 4. Check it works

```bash
ghl auth whoami
ghl contacts search --limit 5
```

### Managing profiles

One profile per sub-account or client. Switch between them freely.

```bash
ghl auth add --name clientA --api-key pit-... --location loc111
ghl auth add --name clientB --api-key pit-... --location loc222
ghl auth list                  # tokens redacted
ghl auth use clientB           # set the default
ghl auth rm clientA
```

Override the default for a single command:

```bash
ghl --profile clientA contacts search
ghl --location loc999 contacts search      # different location, same token
ghl --api-key pit-other contacts search    # different token entirely
```

### Environment variables

```bash
GHL_API_KEY=pit-... GHL_LOCATION_ID=abc123 ghl contacts search
```

Credentials resolve in this order, first match wins:

1. `--api-key` flag
2. `GHL_API_KEY` env var
3. `--profile <name>` flag
4. `GHL_PROFILE` env var
5. the default profile

> **Gotcha:** if `GHL_API_KEY` is exported in your shell it beats every saved profile, so `ghl auth use <name>` will appear to do nothing. `unset GHL_API_KEY` if a profile seems to be ignored.

---

## Output and exit codes

| Mode | When | Force it with |
|------|------|---------------|
| JSON (compact) | piped / non-TTY | `--json` |
| JSON (pretty) | — | `--pretty` |
| Table | interactive TTY | default in a terminal |
| Quiet | — | `-q` / `--quiet` (data payload only) |

Exit codes: `0` success · `1` GHL API error · `2` CLI usage error.

Errors always go to stderr; stdout stays clean JSON or table data, so it is always safe to pipe.

---

## Quickstart

```bash
# Explore
ghl --help
ghl contacts --help

# Find a command by keyword — you do not need to memorise 576 names
ghl search appointment
ghl search "send sms"

# Read
ghl contacts get <contactId>
ghl contacts search --limit 20

# Write
ghl contacts create --first-name Jane --last-name Doe --email jane@example.com

# Any endpoint at all (escape hatch — works even for ops not in the specs)
ghl raw GET /contacts/search/duplicate --query email=jane@example.com

# Pipe to jq
ghl contacts search --limit 5 --pretty | jq '.contacts[].email'
```

---

## For AI agents

If you are a Claude Code agent (or similar), read these before running commands:

- **`.claude/skills/ghl-cli/SKILL.md`** — the operating procedure: discovering commands, handling auth, reading errors, staying token-frugal.
- **`docs/agent-guide.md`** — worked multi-step examples and GHL gotchas (scopes, `locationId`, API versions, pagination, rate limits).

**Never assume a command name.** There are 576 operations generated from the official specs. Verify with `ghl <domain> --help` or `ghl search <keyword>` first.

---

## How it works

```
spec/*.json                     41 official GHL OpenAPI specs (vendored)
  │  scripts/gen.ts  (pnpm gen)
  ▼
src/generated/operations.ts     flat Operation[] (576 ops) — AUTO-GENERATED
  │  src/buildCommands.ts
  ▼
Commander command tree          ghl <domain> <command> [positionals] [--flags]
  │  src/params.ts → src/http.ts → GHL API
  ▼
src/output.ts                   JSON (piped) / table (TTY) / --pretty / -q
```

`pnpm gen` reads every spec, resolves `$ref`s, picks the right `Version` header per operation, and emits a typed array of 576 `Operation` records. The runtime is entirely generic: `buildCommands.ts` turns that array into a command tree, `params.ts` maps CLI arguments to HTTP requests, `http.ts` fires them, `output.ts` formats the result. **No command-specific code is ever hand-written.**

`pnpm sync-specs` pulls the latest [`GoHighLevel/highlevel-api-docs`](https://github.com/GoHighLevel/highlevel-api-docs) into `spec/`. Run it, then `pnpm gen`, to pick up new GHL endpoints — no new command code required.

---

## Project layout

```
ghl-cli/
├── spec/                    41 official GoHighLevel OpenAPI specs (vendored — the source of truth)
├── scripts/
│   ├── sync-specs.sh        refresh spec/ from GoHighLevel/highlevel-api-docs
│   └── gen.ts               spec/*.json → src/generated/operations.ts   (pnpm gen)
├── src/
│   ├── types.ts             Operation / Profile / CliConfig / errors / constants
│   ├── generated/
│   │   └── operations.ts    AUTO-GENERATED Operation[] (576 ops) — do not edit
│   ├── http.ts              fetch wrapper: Bearer auth, Version header, timeout, retry, errors
│   ├── config.ts            ~/.config/ghl/config.json — named profiles
│   ├── auth.ts              credential resolution chain
│   ├── params.ts            CLI args → HTTP request (path/query/body, locationId auto-inject)
│   ├── output.ts            JSON / table / quiet output, exit codes
│   ├── buildCommands.ts     OPERATIONS → Commander command tree
│   ├── cli.ts               entry point (the `ghl` bin)
│   └── commands/
│       ├── auth.ts          ghl auth add|list|use|whoami|rm
│       ├── raw.ts           ghl raw <METHOD> <path> …   (escape hatch)
│       ├── search.ts        ghl search <keyword>        (find an operation)
│       └── docs.ts          ghl docs <domain>
├── test/                    vitest
├── docs/
│   ├── DESIGN.md            architecture & decisions
│   ├── usage.md             full command guide for humans
│   ├── agent-guide.md       how an AI agent should drive the CLI
│   ├── recipes.md           copy-paste task recipes
│   └── contributing.md      how to add/refresh endpoints, run checks
├── .claude/skills/ghl-cli/
│   └── SKILL.md             Claude Code skill — load this to operate the CLI
└── .github/workflows/
    ├── ci.yml               typecheck + lint + test
    └── sync-specs.yml       weekly: refresh specs + regen, open PR if changed
```

---

## Development

```bash
pnpm install
pnpm gen          # regenerate src/generated/operations.ts from spec/*.json
pnpm dev <args>   # run from source, no build
pnpm typecheck    # tsc --noEmit
pnpm test         # vitest run
pnpm lint         # biome check src scripts test
pnpm build        # tsup → dist/cli.js
```

**Golden rule:** never hand-edit `src/generated/operations.ts`. Fix the heuristic in `scripts/gen.ts` and re-run `pnpm gen`.

See [`docs/contributing.md`](./docs/contributing.md) to add or refresh endpoints, and [`docs/DESIGN.md`](./docs/DESIGN.md) for architecture decisions.

---

## Scope

This CLI targets the **GoHighLevel v2 public API** with Private Integration Token auth. It is deliberately not:

- a Marketplace OAuth client (no `auth login`, no client id/secret, no refresh tokens),
- a multi-tenant token broker,
- a client for GHL's private/internal APIs (site-builder, workflow-builder).

If you need agency-wide token minting across many sub-accounts, that belongs in a service in front of this CLI, not in the CLI itself.

---

## License

MIT — see [LICENSE](./LICENSE).
