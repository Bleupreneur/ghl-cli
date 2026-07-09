# ghl-cli — Full Command Reference

This is the complete usage guide for the `ghl` CLI. For a quick introduction, see the [README](../README.md). For AI agent usage, see [agent-guide.md](./agent-guide.md).

---

## Global flags

These flags work on every command:

| Flag | Short | Description |
|------|-------|-------------|
| `--profile <name>` | | Use a named credential profile instead of the default |
| `--api-key <key>` | | Override the API key for this invocation (also `GHL_API_KEY` env) |
| `--location <id>` | | Override the locationId for this invocation (also `GHL_LOCATION_ID` env) |
| `--json` | | Force JSON output (useful in a TTY where tables are the default) |
| `--pretty` | | Force pretty-printed JSON output |
| `--quiet` | `-q` | Output data payload only (no wrapper fields) |
| `--help` | `-h` | Show help for the current command |
| `--version` | `-V` | Show CLI version |

---

## Auth commands

All credential management is under `ghl auth`.

### `ghl auth add`

Add a new named credential profile.

```bash
ghl auth add --name <name> --api-key <token> --location <locationId>
```

**Required flags:**
- `--name <name>` — profile name (e.g. `myagency`, `clientA`)
- `--api-key <token>` — Private Integration Token or agency API key
- `--location <id>` — GHL Location ID (also called Company ID)

**Where to get credentials:**
- Private Integration Token: GHL → Settings → Private Integrations → Create new integration. Tick the scopes you need; the token only carries those.
- Location ID: the `<id>` in the sub-account URL `app.gohighlevel.com/v2/location/<id>/…`, also shown under GHL → Settings → Business Profile. (This is *not* the Company ID — that identifies the agency, not the sub-account.)

**Example:**
```bash
ghl auth add --name work --api-key pit-0a1b2c3d-... --location xyz789
```

The profile is saved to `~/.config/ghl/config.json` with permissions `600`. Tokens are never logged or printed in full.

---

### `ghl auth list`

List all saved profiles. API keys are redacted.

```bash
ghl auth list
```

Output:
```
NAME      KIND   LOCATION   DEFAULT
work      pit    xyz789     *
clientA   pit    abc000
```

---

### `ghl auth use`

Set the default profile.

```bash
ghl auth use <name>
```

After this, all commands use `<name>` unless overridden with `--profile`.

---

### `ghl auth whoami`

Show the active profile name, location, and key kind (token type). Does not make an API call.

```bash
ghl auth whoami
```

---

### `ghl auth rm`

Remove a saved profile.

```bash
ghl auth rm <name>
```

If you remove the default profile, run `ghl auth use <other>` to set a new one before running other commands.

---

## Auth resolution order

For every command, credentials are resolved in this order (first wins):

1. `--api-key` + `--location` flags on the command line
2. `GHL_API_KEY` + `GHL_LOCATION_ID` environment variables
3. `--profile <name>` flag
4. `GHL_PROFILE` environment variable
5. The `default` profile in `~/.config/ghl/config.json`
6. Friendly error pointing to `ghl auth add`

---

## Discovery commands

### `ghl --help`

Lists all available domains (one per spec file — 41 total) plus built-in commands (`auth`, `raw`, `search`, `docs`, `version`).

### `ghl <domain> --help`

Lists every command in that domain, with one-line summaries. Example:

```bash
ghl contacts --help
ghl calendars --help
ghl invoices --help
```

### `ghl <domain> <command> --help`

Shows the full reference for one operation:
- One-line summary and longer description
- HTTP method and path (e.g. `GET /contacts/{contactId}`)
- Positional arguments (path params), in order
- Query flags (`--limit`, `--cursor`, `--query`, etc.)
- Body flags (for POST/PUT/PATCH operations)
- Required OAuth scopes
- External docs URL

### `ghl search <keyword>`

Search all ~576 operations by operationId, summary, and path. Returns matching operations with their `ghl <domain> <command>` invocation. Efficient — a few hundred tokens.

```bash
ghl search appointment
ghl search "send sms"
ghl search invoice
ghl search "add tag"
```

### `ghl docs <domain>` / `ghl docs <domain> <command>`

Print the operation reference (summary, description, parameters, scopes, docs link) without the Commander `--help` noise. Useful for agents and scripts.

```bash
ghl docs contacts
ghl docs contacts get
```

---

## Generated commands: `ghl <domain> <command>`

Every GHL API operation has a corresponding `ghl <domain> <command>`. The domain is derived from the spec file name, and the command from the `operationId`.

### Positional arguments (path params)

Path parameters appear as positional arguments, in the order they appear in the URL path. Example:

```bash
# GET /contacts/{contactId}
ghl contacts get <contactId>

# GET /calendars/{calendarId}/events/{eventId}
ghl calendars get-event <calendarId> <eventId>
```

`locationId` and `altId` are **auto-injected** from the active profile. You do not need to pass them unless targeting a different location.

### Query flags

Query parameters map to `--flags`. Boolean flags default to false; number flags accept integers; string flags accept any string. Enums show valid values in `--help`.

```bash
ghl contacts list --limit 20 --cursor eyJpZCI6...
ghl conversations list --type TYPE_PHONE --unread true
```

### Body fields (`--flags`, `--set`, `--data`)

For POST/PUT/PATCH operations, documented top-level body fields have generated `--flags`:

```bash
ghl contacts create --first-name Jane --last-name Doe --email jane@x.com
ghl opportunities update <id> --name "Big Deal" --monetary-value 5000
```

For nested fields, arrays, or fields not in the spec's top-level schema, use `--set k=v` (repeatable):

```bash
ghl contacts update <id> --set "customFields.tier=gold"
ghl contacts create --set 'tags=["vip","trial"]'
```

For opaque or large bodies, use `--data` with inline JSON or a file reference:

```bash
ghl contacts create --data '{"firstName":"Jane","email":"j@x.com"}'
ghl contacts create --data @./contact.json
```

These approaches can be combined (`--flags` for known fields, `--set`/`--data` for the rest).

---

## Output and exit codes

### stdout

| Mode | Trigger |
|------|---------|
| Compact JSON | piped / non-TTY (default) |
| Pretty JSON | `--pretty` |
| Table | interactive TTY (default) |
| Quiet (payload only) | `-q` / `--quiet` |

### stderr

Errors only. Human-readable: HTTP status + GHL error body, or usage hint. Never mixed with stdout.

### Exit codes

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | GHL API error |
| `2` | CLI usage error |

---

## `ghl raw`

Hit any GHL endpoint directly, bypassing the generated command tree. Useful for endpoints not yet covered, debugging, or one-off requests.

```bash
ghl raw <METHOD> <path> [--query k=v]... [--data '<json>'|@file] [--location <id>]
```

- `METHOD`: `GET`, `POST`, `PUT`, `DELETE`, or `PATCH` (case-insensitive).
- `path`: the GHL API path, with or without `{placeholders}` (substitute actual IDs).
- `--query k=v`: repeatable query string parameter.
- `--data '<json>'` or `--data @file`: request body.
- `--location <id>`: override locationId (injected as `locationId` query param on GET, in body on POST/PUT/PATCH).

```bash
ghl raw GET /contacts/{contactId} # substitute real ID
ghl raw GET /contacts/search/duplicate --query email=jane@x.com
ghl raw POST /contacts --data '{"firstName":"Jane","email":"j@x.com","locationId":"xyz789"}'
ghl raw DELETE /contacts/{contactId}/tags --data '{"tags":["old-tag"]}'
```

---

## Domain overview

The table below gives a rough sense of each domain. For the exact command list, run `ghl <domain> --help`.

| Domain | Covers | Approx ops |
|--------|--------|-----------|
| `contacts` | CRM contacts — CRUD, tags, notes, tasks, DnD | 32 |
| `conversations` | Inbox, messages, SMS, email threads | 29 |
| `opportunities` | Pipeline opportunities — CRUD, stage moves | 12 |
| `calendars` | Calendar configuration, appointments, slots, blocked times | 41 |
| `invoices` | Invoice create/send/record-payment, estimates | 42 |
| `payments` | Orders, subscriptions, transactions, coupons | 23 |
| `products` | Product catalog, prices, inventory | 27 |
| `locations` | Sub-account configuration, tags, custom fields | 29 |
| `social-media-posting` | Social accounts, posts, scheduling | 40 |
| `ad-manager` | Meta / Google ad campaigns, ad sets, leads | 94 |
| `workflows` | Workflow list | 1 |
| `forms` | Forms, submissions | 3 |
| `surveys` | Survey definitions, submissions | 2 |
| `funnels` | Funnel pages, redirects | 7 |
| `blogs` | Blog posts, categories, authors | 7 |
| `medias` | Media library upload and list | 7 |
| `emails` | Email send, ISV integration | 6 |
| `campaigns` | Campaign list | 1 |
| `links` | Short links (tracking links) | 6 |
| `businesses` | Business profile | 5 |
| `companies` | Company (agency) details | 1 |
| `users` | User management, roles, locations | 7 |
| `custom-fields` | Custom field definitions | 8 |
| `custom-menus` | Custom navigation menus | 5 |
| `objects` | Custom CRM object schemas | 9 |
| `associations` | CRM object association schemas | 10 |
| `brand-boards` | Brand kit assets | 5 |
| `courses` | Course (membership) data | 1 |
| `proposals` | Proposal / estimate documents | 4 |
| `affiliate-manager` | Affiliate campaigns, referrals, commissions | 4 |
| `phone-system` | Phone numbers, call forwarding | 4 |
| `voice-ai` | Voice AI agent configuration | 11 |
| `conversation-ai` | Conversation AI / bot configuration | 12 |
| `agent-studio` | Agent Studio bots | 11 |
| `knowledge-base` | Knowledge base articles and collections | 14 |
| `saas-api` | SaaS mode — sub-account provisioning, rebilling | 22 |
| `snapshots` | Snapshot import/export | 4 |
| `marketplace` | Marketplace app management | 9 |
| `oauth` | OAuth token endpoints | 3 |
| `store` | E-commerce store, shipping, fulfillment | 18 |

---

## Troubleshooting

**`401 Unauthorized`** — token is invalid or expired.
- Run `ghl auth whoami` to confirm which profile is active.
- Re-add with `ghl auth add --name ... --api-key <new_token> --location ...`.

**`403 Forbidden`** — token lacks the required OAuth scope.
- The required scopes are listed in `ghl <domain> <command> --help`.
- For PITs, ensure the integration was created with the needed permissions.

**`404 Not Found`** — wrong ID or wrong locationId.
- Verify the ID is correct.
- Try `--location <id>` to target a different sub-account.

**`422 Unprocessable Entity`** — body validation failed.
- Check `ghl <domain> <command> --help` for required body fields.

**`429 Too Many Requests`** — the CLI retries automatically with exponential backoff. If it still fails, your integration may be hitting GHL's daily rate limit; wait and retry.

**Version header:** Some endpoints require `Version: 2021-04-15` (mainly calendar events, blocked slots, Conversation AI). The codegen selects the correct version automatically. If you are using `ghl raw` and get unexpected results, try adding the correct version manually (this is a known limitation of the raw command; generated commands always use the right version).

**Missing profile:** `Error: no credentials found` → run `ghl auth add` as described above.
