# Recipes — Copy-Paste GHL CLI One-liners

Verify flags with `--help` before running — exact flag names are generated from the official OpenAPI specs and may differ from these examples.

---

## Contacts

```bash
# List first 20 contacts
ghl contacts list --limit 20

# Get a specific contact by ID
ghl contacts get <contactId>

# Create a contact
ghl contacts create --first-name Jane --last-name Doe --email jane@example.com --phone "+15551234567"

# Search contacts by email
ghl contacts search-contacts --help  # check: may be search-contacts-advanced or search-contacts
ghl contacts search-contacts --email jane@example.com

# Search contacts by full text query
ghl contacts search-contacts --query "Jane Doe"

# Add tags to a contact
ghl contacts add-tags <contactId> --set 'tags=["vip","trial"]'

# Remove tags from a contact
ghl contacts remove-tags <contactId> --set 'tags=["trial"]'

# Update a contact's custom field
ghl contacts update <contactId> --set "customFields.plan=enterprise"

# Get all notes on a contact
ghl contacts list-notes <contactId>

# Create a note on a contact
ghl contacts create-note <contactId> --body "Called and left voicemail."

# Get all tasks for a contact
ghl contacts list-tasks <contactId>

# Mark a contact as DND
ghl contacts update-dnd <contactId> --set 'dnd=true'

# List appointments for a contact
ghl contacts list-appointments <contactId>

# Extract just emails from a contact list
ghl contacts list --limit 50 | jq -r '.contacts[].email'

# Get a contact ID by email (search + jq)
ghl contacts search-contacts --email jane@example.com | jq -r '.contacts[0].id'
```

---

## Conversations

```bash
# List recent conversations
ghl conversations list-conversations --limit 20

# Get conversations for a specific contact
ghl conversations search-conversations --contact-id <contactId>

# Get messages in a conversation
ghl conversations get-messages <conversationId>

# Send an SMS
ghl conversations send-message --conversation-id <id> --type TYPE_SMS --message "Hi there!"

# Send an email reply
ghl conversations send-message --conversation-id <id> --type TYPE_EMAIL --message "Following up..."

# Mark a conversation as read
ghl conversations update-conversation <id> --set 'unreadCount=0'

# List unread conversations
ghl conversations list-conversations --unread true

# Get a conversation's full history and filter to last 5 messages
ghl conversations get-messages <id> | jq '.messages[-5:]'
```

---

## Opportunities

```bash
# List all opportunities
ghl opportunities list

# List opportunities in a specific pipeline
ghl opportunities list --pipeline-id <pipelineId>

# Get a specific opportunity
ghl opportunities get <opportunityId>

# Create an opportunity
ghl opportunities create \
  --pipeline-id <pipelineId> \
  --stage-id <stageId> \
  --contact-id <contactId> \
  --name "Deal Name" \
  --monetary-value 5000

# Move opportunity to a new stage
ghl opportunities update <opportunityId> --stage-id <newStageId>

# Update opportunity status
ghl opportunities update <opportunityId> --status won

# List available pipelines (to get pipeline/stage IDs)
ghl opportunities list-pipelines | jq '.pipelines[] | {id, name}'

# Get stage IDs from a pipeline
ghl opportunities list-pipelines | jq '.pipelines[0].stages[] | {id, name}'
```

---

## Calendars

```bash
# List all calendars
ghl calendars list | jq '.calendars[] | {id, name}'

# Get a specific calendar
ghl calendars get-calendar <calendarId>

# Get available slots for booking
ghl calendars get-slots <calendarId> \
  --start-date "2026-06-01" \
  --end-date "2026-06-07" \
  --timezone "America/New_York"

# Get appointments for a date range
ghl calendars get-appointments <calendarId> \
  --start-time "2026-06-01T00:00:00Z" \
  --end-time "2026-06-07T23:59:59Z"

# Create an appointment
ghl calendars create-appointment \
  --calendar-id <calendarId> \
  --contact-id <contactId> \
  --start-time "2026-06-03T10:00:00-04:00" \
  --end-time "2026-06-03T10:30:00-04:00" \
  --title "Discovery Call"

# Update appointment notes
ghl calendars update-appointment <appointmentId> --set 'notes=Reschedule requested'

# Delete an appointment
ghl calendars delete-appointment <appointmentId>
```

---

## Invoices and Payments

```bash
# List invoices
ghl invoices list

# Get a specific invoice
ghl invoices get <invoiceId>

# Create an invoice
ghl invoices create \
  --contact-id <contactId> \
  --set 'title=Service Invoice' \
  --set 'currency=USD'

# Send an invoice (trigger email delivery)
ghl invoices send <invoiceId>

# Record a manual payment on an invoice
ghl invoices record-payment <invoiceId> \
  --set 'mode=cash' \
  --set 'amount=500'

# List orders
ghl payments list-orders

# Get a specific order
ghl payments get-order <orderId>

# List transactions for a date range
ghl payments list-transactions \
  --start-at "2026-05-01" \
  --end-at "2026-05-31"

# List subscriptions
ghl payments list-subscriptions

# Get a coupon
ghl payments get-coupon <couponId>
```

---

## Products

```bash
# List products in the catalog
ghl products list-products

# Get a specific product
ghl products get-product <productId>

# Create a product
ghl products create-product \
  --name "Consultation Package" \
  --set 'description=Initial 60-min consultation'

# List prices for a product
ghl products list-prices <productId>

# Create a price variant
ghl products create-price <productId> \
  --set 'name=Standard' \
  --set 'amount=29900' \
  --set 'currency=USD' \
  --set 'type=one_time'
```

---

## Locations

```bash
# Get the current location's details
ghl locations get-location <locationId>

# Search locations (agency-level)
ghl locations search-locations --query "Dr. Lead"

# Get all tags for a location
ghl locations get-tags <locationId>

# Create a tag
ghl locations create-tag <locationId> --name "New Patient"

# Get custom fields for a location
ghl locations get-custom-fields <locationId>

# Create a custom field
ghl locations create-custom-field <locationId> \
  --name "Patient ID" \
  --set 'dataType=TEXT'

# Get location time zones
ghl locations get-timezones | jq '.timezones[]' | head -20
```

---

## Social Media Posting

```bash
# List connected social accounts
ghl social-media-posting list-accounts | jq '.accounts[] | {id, platform, name}'

# List scheduled posts
ghl social-media-posting list-posts --limit 20

# Create a social post
ghl social-media-posting create-post \
  --set 'summary=Check out our latest offer!' \
  --set 'postType=content' \
  --set 'scheduleType=schedule'

# Get a specific post
ghl social-media-posting get-post <postId>

# Delete a post
ghl social-media-posting delete-post <postId>
```

---

## Workflows

```bash
# List all workflows
ghl workflows list-workflows | jq '.workflows[] | {id, name, status}'
```

---

## Misc

```bash
# Check CLI version
ghl version

# Search for any operation by keyword
ghl search "outbound call"
ghl search "bulk"
ghl search "export"

# Get operation docs without --help noise
ghl docs contacts
ghl docs contacts get

# Hit an endpoint not covered by a generated command
ghl raw GET /contacts/search/duplicate --query email=jane@example.com
ghl raw GET /locations/<locationId>/settings

# Use a specific profile for one command
ghl --profile clientA contacts list --limit 5

# Use a one-off API key without saving it
GHL_API_KEY=pit_xxx GHL_LOCATION_ID=abc123 ghl contacts list

# Extract specific fields with jq and save to file
ghl contacts list --limit 100 | jq '[.contacts[] | {id, email, firstName}]' > contacts.json

# Count contacts returned
ghl contacts list --limit 100 | jq '.contacts | length'

# Find a contact ID, then get their conversations
CID=$(ghl contacts search-contacts --email jane@example.com | jq -r '.contacts[0].id')
ghl conversations search-conversations --contact-id "$CID" | jq '.conversations[] | {id, lastMessage}'
```
