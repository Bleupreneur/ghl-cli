---
name: ghl-cli
description: >
  Use when working with GoHighLevel / GHL / LeadConnector data via the command line —
  contacts, conversations, opportunities, calendars, appointments, invoices, payments,
  products, workflows, locations, custom fields/objects, social posts, blogs, email,
  SaaS, forms, surveys, or any other GHL domain — and a `ghl` CLI is available in the
  shell environment. Covers the full v2 public API (~576 operations, 41 domains).
---

# ghl-cli — Agent Operating Procedure

The `ghl` CLI exposes the full GoHighLevel v2 public API as shell commands. It is generated from the official OpenAPI specs. This document is your operating procedure.

**Key principle: discover, don't memorize.** There are 576 operations across 41 domains. Do not guess command names. Use `--help` and `ghl search` to find what you need.

---

## 1. Discovery workflow

```
ghl --help                              # lists all 41 domains + built-in commands
ghl <domain> --help                     # lists every command in that domain
ghl <domain> <command> --help           # flags, positional args, body fields, scopes, docs URL
ghl search <keyword>                    # jump straight to a command without browsing --help
```

**Decision tree:**
- Know the domain? → `ghl <domain> --help` to see commands.
- Know a keyword? → `ghl search <keyword>` (e.g. `ghl search appointment`, `ghl search "send sms"`, `ghl search invoice`).
- Know nothing? → `ghl --help`, then explore.

Always read the output of `--help` before running a write operation. The help shows required positional args, all available flags, and the HTTP method + path.

---

## 2. Auth

The CLI authenticates with a **Private Integration Token** only. Assume a profile is already configured. If a command fails with a credentials error (exit code 2 "No GHL credentials", or exit code 1 with `401`/`Invalid Private Integration token`), tell the user:

```bash
ghl auth add --name <name> --api-key <pit_token> --location <locationId> --default
```

- Get a Private Integration Token at: GHL → Settings → Private Integrations. The token only carries the scopes ticked at creation time.
- Get the Location ID from the sub-account URL `app.gohighlevel.com/v2/location/<id>/…`, or GHL → Settings → Business Profile. It is **not** the Company ID.

Do not ask for tokens in chat. Do not hardcode them. The CLI never logs full tokens.

**If `ghl auth use <name>` seems to have no effect**, check for an exported `GHL_API_KEY` — env vars beat saved profiles in the resolution chain, so a stale env var silently shadows every profile. `unset GHL_API_KEY GHL_LOCATION_ID` and retry.

---

## 3. locationId is usually automatic

The active profile's `locationId` is auto-injected into any operation that accepts `locationId` or `altId`. You only need to be explicit when:

- Targeting a **different sub-account**: `ghl --location <otherId> contacts list`
- Switching profiles entirely: `ghl --profile clientA opportunities list`

---

## 4. Reading output

**Output is JSON when piped.** Pipe to `jq` to extract fields:

```bash
ghl contacts list --limit 5 | jq '.contacts[].email'
ghl contacts get <id> | jq '{name: .firstName, phone: .phone}'
```

Use `--pretty` for readable JSON without piping. Use `-q` for the data payload only (suppresses metadata). Tables appear automatically when running in an interactive terminal.

---

## 5. Writing data

Simple fields use generated `--flags`:
```bash
ghl contacts create --first-name Jane --last-name Doe --email jane@x.com --phone "+15551234567"
```

For nested or complex body fields, use `--set` (repeatable, supports dotted keys and JSON values):
```bash
ghl contacts update <id> --set "tags=[\"vip\",\"trial\"]"
ghl contacts update <id> --set "customFields.plan=enterprise"
```

For opaque or large bodies, use `--data` with inline JSON or a file:
```bash
ghl contacts create --data '{"firstName":"Jane","email":"j@x.com"}'
ghl contacts create --data @contact.json
```

Always check `ghl <domain> <command> --help` to see which flags exist for body fields before resorting to `--set` or `--data`.

---

## 6. Escape hatch: `ghl raw`

If no generated command fits, hit any endpoint directly:

```bash
ghl raw GET /contacts/{contactId}/tags --query limit=10
ghl raw POST /contacts/{contactId}/tags --data '{"tags":["vip"]}'
ghl raw DELETE /contacts/{contactId}/tags --data '{"tags":["old-tag"]}'
```

Replace `{contactId}` with the actual ID. Use `--query k=v` for query string params (repeatable).

**Docs for an operation without --help noise:**
```bash
ghl docs contacts search-contacts-advanced
ghl docs calendars
```

---

## 7. Exit codes and errors

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | GHL API error (read stderr — contains HTTP status + GHL error body) |
| `2` | CLI usage error (wrong flags, missing required arg — read stderr for the hint) |

**Common error patterns:**

- `401 Unauthorized` — token is wrong or expired. Check `ghl auth whoami`. Re-add the profile.
- `403 Forbidden` — token lacks the required OAuth scope listed in `--help`. Use a PIT with broader permissions or a token from the right integration.
- `404 Not Found` — wrong ID, or operation requires a `locationId` that differs from the profile default. Try `--location <id>`.
- `422 Unprocessable Entity` — body validation failed. Check required fields in `--help`.
- `429 Too Many Requests` — the CLI retries automatically with backoff. If it still fails, slow down.

---

## 8. Token discipline

This CLI exists because loading the GHL MCP server's ~500 tool schemas costs ~80–100K tokens per session. **Do not recreate that cost** by dumping large `--help` outputs speculatively into context.

Instead:
- Fetch only the `--help` for the domain/command you actually need.
- Use `ghl search <keyword>` (a few hundred tokens) to locate a command before opening its `--help`.
- Once you have the command, run it and process the output.

---

## Worked example: find a contact by email and add a tag

```bash
# Step 1: find the right search command
ghl search "search contact"
# → shows: ghl contacts search-contacts  (GET /contacts/search)

# Step 2: check flags
ghl contacts search-contacts --help
# → shows --email flag, returns contacts[]

# Step 3: search by email, grab the id
CONTACT_ID=$(ghl contacts search-contacts --email "jane@example.com" | jq -r '.contacts[0].id')
echo "Contact ID: $CONTACT_ID"

# Step 4: find the tag command
ghl contacts --help | grep -i tag
# → shows: add-tags, remove-tags

# Step 5: check the add-tags command
ghl contacts add-tags --help
# → shows: positional: contactId; --set or --tags flag

# Step 6: add the tag
ghl contacts add-tags "$CONTACT_ID" --set 'tags=["vip"]'
```

Always verify flags at each step rather than guessing. The specs are the source of truth.

---

## Global flags (work on every command)

| Flag | Effect |
|------|--------|
| `--profile <name>` | Use a named profile instead of the default |
| `--api-key <key>` | Override the API key for this invocation |
| `--location <id>` | Override the locationId for this invocation |
| `--json` | Force JSON output |
| `--pretty` | Force pretty-printed JSON output |
| `-q`, `--quiet` | Output data payload only |

---

## Domains at a glance

Run `ghl --help` for the live list. Key domains:

`contacts` · `conversations` · `opportunities` · `calendars` · `invoices` · `payments` · `products` · `locations` · `workflows` · `social-media-posting` · `ad-manager` · `forms` · `surveys` · `funnels` · `blogs` · `emails` · `businesses` · `users` · `custom-fields` · `knowledge-base` · `saas-api` · `voice-ai` · `conversation-ai` · `agent-studio` + more

For more detail, see `docs/agent-guide.md`.
