# Agent Guide — Driving ghl-cli

This guide is for AI agents that need to work with GoHighLevel data via the `ghl` CLI. It covers the discovery workflow, token discipline, error handling, GHL-specific gotchas, and fully worked multi-step examples.

For the quick-reference operating procedure, see [`.claude/skills/ghl-cli/SKILL.md`](../.claude/skills/ghl-cli/SKILL.md).

---

## Why use this CLI instead of the MCP server?

The GHL MCP server exposes ~500 tool schemas. Every session loads all of them into context — approximately **80–100K tokens before any work happens**. For a 200K context window, that is 40–50% of your budget spent on tool descriptions you will not use.

The CLI is **one Bash tool**. Discovery is on-demand:

| Action | Token cost |
|--------|-----------|
| `ghl --help` (list all domains) | ~300 |
| `ghl <domain> --help` (list commands) | ~500–900 |
| `ghl <domain> <command> --help` (one operation) | ~200–500 |
| `ghl search <keyword>` | ~150 |
| MCP server idle cost | ~80–100K |

A 10-step task costs ~2–6K tokens of discovery overhead vs. ~100K for the MCP server.

---

## Discovery workflow

```
Have a keyword?
  yes → ghl search <keyword>             # finds matching operations fast
  no  → ghl --help                       # shows all 41 domains
         → ghl <domain> --help           # shows all commands in domain
          → ghl <domain> <command> --help  # shows exact flags, scopes, docs URL
```

**Always run `--help` before a write operation** to confirm required positionals and body flags.

---

## Auth

Assume profiles are already configured via `ghl auth add`. If a command exits with code `1` and the error body contains "unauthorized" or "invalid token":

1. Tell the user to run:
   ```bash
   ghl auth add --name <name> --api-key <pit_token> --location <locationId>
   ghl auth use <name>
   ```
2. Tokens come from: GHL → Settings → Private Integrations
3. Location ID from: GHL → Settings → Business Profile → Company ID

Do not ask for tokens in conversation. Do not hardcode them anywhere. The CLI never logs full tokens.

---

## locationId and altId

Most GHL operations are scoped to a sub-account (location). The active profile's `locationId` is injected automatically. You do not need to pass it explicitly unless:

- **Targeting a different sub-account:** `ghl --location <otherId> contacts list`
- **Switching profiles:** `ghl --profile clientB opportunities list`

Some older endpoints use `altId` / `altType` instead of `locationId`. The codegen normalizes this — generated commands always use the right parameter name. For `ghl raw`, use the field name that appears in the spec's path/body (check `ghl docs <domain> <command>`).

---

## API versions

GHL has two Version header values:

- `2021-07-28` — most endpoints (contacts, opportunities, invoices, payments, etc.)
- `2021-04-15` — calendar events, blocked slots, Conversation AI agents, outbound calls

The codegen picks the right version per operation automatically. For `ghl raw`, you may need to specify it manually if results are unexpected — check the spec or `ghl docs` for the correct version.

---

## Pagination

GHL uses cursor-based pagination for list endpoints. The response includes a `meta.nextPageUrl` or a `meta.cursor` field. Pass it back as `--cursor <value>` on the next call.

```bash
# Page 1
ghl contacts list --limit 100 | jq -r '.meta.nextPageUrl'

# Page 2 (pass cursor, not full URL)
ghl contacts list --limit 100 --cursor <cursor_from_page_1>
```

Do not use offset-based pagination on list endpoints that return a cursor — only some endpoints support both.

---

## Rate limits

GHL enforces rate limits per integration token. The CLI retries `429 Too Many Requests` responses automatically with exponential backoff. If a command takes longer than usual, it is probably hitting rate limits and retrying. Do not run tight loops of individual API calls — batch where possible using list endpoints.

---

## Reading errors

Exit code `1` = GHL API error. Stderr contains:

```
GHL API 422 Unprocessable Entity on POST https://services.leadconnectorhq.com/contacts
{
  "message": "email is not valid"
}
```

Parse: `HTTP status` + `status text` + `method` + `URL` + optional JSON body from GHL.

Common patterns:

| Status | Likely cause | Fix |
|--------|-------------|-----|
| `401` | Bad token | Re-add profile with fresh token |
| `403` | Missing scope | Recreate PIT with required scopes (shown in `--help`) |
| `404` | Wrong ID or wrong location | Verify ID; try `--location <correct_id>` |
| `422` | Body validation failed | Check required fields in `--help` |
| `429` | Rate limited | CLI retries automatically; if persistent, slow down |

Exit code `2` = CLI usage error (wrong flags, missing positional, unknown profile). Read stderr for the hint.

---

## Worked example 1: Create a contact and an opportunity

```bash
# 1. Find the contacts create command
ghl search "create contact"
# → contacts create  (POST /contacts)

# 2. Check flags
ghl contacts create --help
# → shows --first-name, --last-name, --email, --phone, --locationId (auto), ...

# 3. Create the contact, capture the id
CONTACT_ID=$(ghl contacts create \
  --first-name Jane \
  --last-name Doe \
  --email jane@example.com \
  --phone "+15551234567" \
  | jq -r '.contact.id')
echo "Created contact: $CONTACT_ID"

# 4. Find pipeline/stage IDs needed for the opportunity
ghl search pipeline
ghl opportunities --help | grep pipeline
ghl opportunities list-pipelines --help

PIPELINE_ID=$(ghl opportunities list-pipelines | jq -r '.pipelines[0].id')
STAGE_ID=$(ghl opportunities list-pipelines | jq -r '.pipelines[0].stages[0].id')

# 5. Check opportunity create flags
ghl opportunities create --help

# 6. Create the opportunity
ghl opportunities create \
  --pipeline-id "$PIPELINE_ID" \
  --stage-id "$STAGE_ID" \
  --contact-id "$CONTACT_ID" \
  --name "Jane Doe — Initial Consultation" \
  --monetary-value 1500
```

---

## Worked example 2: Search conversations and send a reply

```bash
# 1. Find the right conversation commands
ghl search conversation
ghl conversations --help

# 2. Search conversations for a contact
ghl conversations search-conversations --help
# → shows --contact-id, --type, --unread flags

CONV_ID=$(ghl conversations search-conversations \
  --contact-id "$CONTACT_ID" \
  | jq -r '.conversations[0].id')

# 3. Get the latest messages
ghl conversations get-messages "$CONV_ID" | jq '.messages[-3:]'

# 4. Send an SMS reply
ghl conversations send-message --help
# → shows --conversation-id, --type, --message flags

ghl conversations send-message \
  --conversation-id "$CONV_ID" \
  --type TYPE_SMS \
  --message "Hi Jane, thanks for reaching out. We'll call you shortly."
```

---

## Worked example 3: List calendars → get free slots → book an appointment

```bash
# 1. List calendars
ghl calendars list | jq '.calendars[] | {id, name}'

CAL_ID="<choose one>"

# 2. Get available slots
ghl calendars get-slots --help
# → shows --calendar-id (positional), --start-date, --end-date, --timezone

ghl calendars get-slots "$CAL_ID" \
  --start-date "2026-05-20" \
  --end-date "2026-05-21" \
  --timezone "America/New_York" \
  | jq '.slots | to_entries | .[0]'

# 3. Book the appointment
ghl calendars create-appointment --help

ghl calendars create-appointment \
  --calendar-id "$CAL_ID" \
  --contact-id "$CONTACT_ID" \
  --start-time "2026-05-20T09:00:00-04:00" \
  --end-time "2026-05-20T09:30:00-04:00" \
  --title "Discovery Call — Jane Doe"
```

---

## Worked example 4: Bulk-tag contacts from a search result

```bash
# 1. Find contacts matching a condition
ghl contacts list --query "source=website" | jq -r '.contacts[].id' > /tmp/contact_ids.txt

# 2. Check the add-tags command
ghl contacts add-tags --help
# → positional: contactId; --set tags=[...]

# 3. Add tag to each contact
while IFS= read -r id; do
  ghl contacts add-tags "$id" --set 'tags=["website-lead"]'
done < /tmp/contact_ids.txt
```

For large batches, add `--quiet` to suppress per-call output: `ghl contacts add-tags "$id" --set '...' -q`

---

## Token-frugal patterns

**Do:**
- `ghl search <keyword>` to locate a command before opening its `--help`.
- Fetch `--help` for only the domain/command you need.
- Pipe to `jq` to extract just the fields you need, not the full response.
- Cache IDs you discover (calendar ID, pipeline ID) across steps in a task.

**Don't:**
- Dump `ghl --help` or `ghl <domain> --help` speculatively into context.
- Loop `ghl search` for multiple unrelated keywords in sequence — use it once with the most specific keyword.
- Call individual `get` endpoints in a loop where a `list` endpoint would work.

---

## Escape hatch: `ghl raw`

When no generated command fits:

```bash
ghl raw GET /contacts/{contactId}
ghl raw POST /contacts --data '{"firstName":"Jane","locationId":"xyz"}'
ghl raw PATCH /opportunities/{id} --data '{"monetaryValue":2500}'
```

Use `ghl docs <domain> <command>` to get the operation reference (method, path, params, scopes) without running the command.

---

## When the CLI is not available

If `ghl` is not installed or the PATH is wrong:

```bash
# Check if installed
which ghl || npx @bleupreneur/ghl-cli --help

# Run from source
cd ~/path/to/ghl-cli && pnpm dev -- contacts list
```

If you need to install it:
```bash
npm install -g @bleupreneur/ghl-cli
```
