# IT Ticketing — Workflow Guide

Production IT Helpdesk ticketing for **n8n + Microsoft Outlook + Excel (OneDrive/SharePoint)**.

This guide explains the Main workflow (v2 fault-tolerant), the Error Notifier companion, the Excel workbook, AI summarization credentials, and how to debug failures.

---

## What you get

| File | Purpose |
|------|---------|
| [workflows/IT_Ticketing_Main.json](workflows/IT_Ticketing_Main.json) | **Business workflow** — Outlook Trigger → AI summary → ticket → ack → folder move (with ack resume) |
| [workflows/IT_Ticketing_Error_Notifier.json](workflows/IT_Ticketing_Error_Notifier.json) | Alerts admin when Main fails (n8n requires Error Trigger in a separate workflow) |
| [scripts/generate_it_support_workbook.py](scripts/generate_it_support_workbook.py) | Builds the Excel workbook (tables, dropdowns, dashboard, audit log, AI/stage columns) |
| [scripts/_build_workflows.py](scripts/_build_workflows.py) | Regenerates Main + Error Notifier JSON |
| [assets/IT Support Tickets.xlsx](assets/IT%20Support%20Tickets.xlsx) | Generated workbook v2.0 — upload to OneDrive/SharePoint |
| `workflows/ClaudeFlows/` | Previous complex design — **do not use**; kept for reference only |
| `workflows/v2 - current working/` | Previous schedule-based flow — superseded by Main |

---

## Architecture

```text
Email arrives in IT Support Inbox
        │
        ▼
Outlook Trigger (one execution = one email)
        │
        ▼
Extract / filter (drop self-sent & auto-replies)
        │
        ├── drop ──► Move to Processed ──► STOP
        │
        ▼
Excel lookup by Conversation ID
        │
        ├── found + Ack Sent = Yes ──► Move to Open Tickets ──► STOP
        │
        ├── found + Ack Sent ≠ Yes ──► Resume Reply → Mark Ack → Move → Mark Complete
        │
        ▼ (new conversation)
Generate ticket ID  NGI-<ddmmyy>-<XXXX>
        │
        ▼
Excel lookup Ticket ID (retry generate up to 5× if collision)
        │
        ▼
Data Guard (required fields)
        │
        ├── invalid ──► Create Needs Review row → Move to Open Tickets
        │
        ▼
AI Summarize (OpenRouter / optional Groq) → Merge with defaults if AI fails
        │
        ▼
Excel append ticket (Processing Stage=Created, Ack Sent=No, AI fields)
        │
        ▼
Excel append AuditLog (non-blocking if this fails)
        │
        ▼
Outlook Reply (Reply All HTML ack)
        │
        ▼
Excel update Ack Sent=Yes, Processing Stage=Acked
        │
        ▼
Move to Open Tickets
        │
        ▼
Excel update Processing Stage=Complete, Folder=Open Tickets
```

Unhandled errors anywhere → **Error Notifier** emails the admin.

**Why two workflows?** n8n’s Error Trigger cannot live inside the Main workflow. All ticket logic is still in **one** place: Main.

---

## Design decisions (and why)

### Outlook Trigger only (no Schedule)

Each new Inbox message starts one execution. Reliability comes from:

1. **Move out of Inbox** after success / follow-up / drop / invalid  
2. **Conversation ID idempotency** — retries cannot create a second ticket  
3. **Ack Sent + Processing Stage** — resume acknowledgement if reply failed after Excel write  
4. **Workflow concurrency = 1** — serial executions; no Excel race conditions  

**No Excel lock sheet.** ClaudeFlows-style `WorkflowLocks` are intentionally not used.

**Honest caveat:** Microsoft Graph webhooks can rarely miss an event. If that appears in production, add a thin reconciliation later.

### New vs follow-up vs resume

**Primary key:** Excel `Conversation ID`.

| Lookup result | Behavior |
|---------------|----------|
| No row | Create new ticket path |
| Row exists, `Ack Sent` = Yes | Follow-up: move to Open Tickets only (no second ack) |
| Row exists, `Ack Sent` ≠ Yes | **Resume:** send ack using existing Ticket ID, then mark Acked → Complete |

### Ticket ID format

```text
NGI-<ddmmyy>-<XXXX>
```

Example: `NGI-310726-A7K9`

- `XXXX` = random A–Z / 0–9  
- Before write: Excel lookup on `Ticket ID`; on hit, regenerate (max 5 attempts)  

### Order of operations (partial failure safety)

1. Write Excel row first (`Ack Sent=No`, `Processing Stage=Created`)  
2. Audit (optional)  
3. Reply  
4. Update `Ack Sent=Yes` / `Acked`  
5. Move folder  
6. Update `Complete`  

| Failure point | Result | Recovery |
|---------------|--------|----------|
| Excel fails | No ticket, no reply; email still in Inbox | Error alert; Graph may retry |
| Reply fails after Excel | Ticket exists; user got no ack; `Ack Sent=No` | Next same Conversation ID → **resume ack** (no duplicate) |
| Move fails after ack | Ticket + ack done; mail still in Inbox | Next run: Ack=Yes → move-only follow-up |
| AI fails | Defaults filled from body/priority/sender | Ticketing continues (`continueOnFail`) |

### Stage flag writes (no Excel Table `update`)

The official n8n **Microsoft Excel (OneDrive)** node Table resource only supports: **append**, **getRows**, **getColumns**, **lookup** — there is **no `update` operation** ([docs](https://docs.n8n.io/integrations/builtin/app-nodes/n8n-nodes-base.microsoftexcel/)).

Ack / Complete flags are written with the documented fallback:

1. Excel **getRows** on `ITTickets` (find row by `Ticket ID`)
2. Code node computes Excel cell addresses (`Z`/`AA`/`R`/`S`)
3. **HTTP Request** `PATCH` Microsoft Graph [range update](https://learn.microsoft.com/en-us/graph/api/range-update) using the existing **Microsoft Excel OAuth2** credential ([custom API actions](https://docs.n8n.io/integrations/builtin/custom-api-actions-for-existing-nodes/))

### Folders (three only)

```text
Inbox
Open Tickets
Processed
```

| Folder | Used by workflow | Purpose |
|--------|------------------|---------|
| Inbox | Trigger source | New requests |
| Open Tickets | Auto | Active tickets, follow-ups, invalid (Needs Review status) |
| Processed | Auto | Dropped self-sent / OOO; closed tickets (manual) |

### CC handling

Extract stores `ccEmails`. Ack uses Outlook reply with `replyToSenderOnly=false` (Graph Reply All), so original CCs stay on the thread.

### Concurrency

Set Main → Settings → **Concurrency = 1**.

---

## Prerequisites (ops checklist)

### 1. n8n & Microsoft

- [ ] n8n instance with a **public HTTPS URL** (required for Outlook Trigger / Graph webhooks)  
- [ ] Credential: **Microsoft Outlook OAuth2** on the IT Support mailbox  
- [ ] Credential: **Microsoft Excel OAuth2** for the same account’s OneDrive/SharePoint  
- [ ] Credential: **OpenRouter** (or **Groq**) for AI summarization — see below  

### 2. Outlook folders

Create under the IT Support mailbox root:

```text
Inbox
Open Tickets
Processed
```

After import, open **every Move node** and reselect the folder (IDs are tenant-specific).

### 3. Excel workbook

```bash
python scripts/generate_it_support_workbook.py
# optional NGI-named copy:
python scripts/generate_it_support_workbook.py --output "assets/IT Support Tickets NGI.xlsx"
```

The script prints **Workbook verification PASS** (or fails) before you upload.

Upload the xlsx to IT Support OneDrive/SharePoint. In every Excel node, reselect workbook + `Tickets`/`ITTickets` + `Audit Log`/`AuditLog`.

Sheets: Dashboard, Tickets (`ITTickets`), Configuration, Categories, Users, Audit Log (`AuditLog`), Reports.

### 4. AI credentials (OpenRouter default)

1. Create an API key at [openrouter.ai/keys](https://openrouter.ai/keys)  
2. In n8n: **Credentials → Add → OpenRouter** → paste the key  
   ([official docs](https://docs.n8n.io/integrations/builtin/credentials/openrouter/))  
3. Open **IT Ticketing - Main** → node **OpenRouter Chat Model** → select the credential  
4. Pick a free/cheap model from the dropdown (placeholder in JSON is `openai/gpt-4o-mini`)  
5. Save and activate; send a test email; confirm `AI Issue Summary` / `AI Priority` / `AI Scope` populate  

#### Optional: swap to Groq

1. Create a key in the [Groq console](https://console.groq.com/)  
2. n8n: **Credentials → Add → Groq** ([docs](https://docs.n8n.io/integrations/builtin/credentials/groq/))  
3. Replace the **OpenRouter Chat Model** sub-node with **Groq Chat Model**, attach credential, pick a model  
4. Leave **AI - Summarize Email** (Basic LLM Chain) and **Structured Output Parser** unchanged  

### 5. Wire Error Notifier

1. Import & **activate** `IT Ticketing - Error Notifier`  
2. Main → Settings → **Error Workflow** → select Error Notifier  
3. Update **toRecipients** (`it-admin@nextgeninnov8.com` placeholder)  

### 6. Main settings

- [ ] Concurrency = **1**  
- [ ] Save successful & failed executions  
- [ ] Confirm Extract node self-send filter matches your mailbox  
- [ ] OpenRouter (or Groq) credential attached  
- [ ] Activate Main  

---

## Tickets table columns

Spaced headers (exact):

`Ticket ID`, `Created Date`, `Created Time`, `Requester Name`, `Requester Email`, `CC Emails`, `Subject`, `Email Body`, `Priority`, `Category`, `Department`, `Status`, `Assigned Engineer`, `Conversation ID`, `Internet Message ID`, `Conversation Index`, `Message Id`, `Folder`, `Last Updated`, `Closed Date`, `Resolution Notes`, `Internal Remarks`, `Escalation Level`, `Resolution`, `Closure Reason`, **`Processing Stage`**, **`Ack Sent`**, **`AI Issue Summary`**, **`AI Priority`**, **`AI Scope`**, `Ticket Age Days`, `SLA Remaining Hours`

Defaults on create: Status=`New`, Category/Department=`Other`, AssignedEngineer=`Unassigned`, EscalationLevel=`L1`, Processing Stage=`Created`, Ack Sent=`No`.

Invalid path: Status=`Needs Review`, Processing Stage=`NeedsReview`.

`Ticket Age Days` / `SLA Remaining Hours` are Excel formulas (not written by n8n).

---

## Common failure modes

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Trigger never runs | No public webhook URL | Put n8n behind HTTPS / use n8n Cloud |
| Infinite ack loop | Self filter missing / drop move broken | Confirm mailbox in Extract; fix Processed folder |
| Duplicate tickets | Column mismatch or concurrency > 1 | Reselect Excel table; set concurrency 1 |
| Ticket without ack email | Reply failed after create | Re-trigger same thread or wait for Graph retry — resume path sends ack |
| Excel append/update error | Column names differ from workbook | Regenerate v2.0 workbook; reselect columns |
| AI columns empty | No OpenRouter/Groq credential or model | Attach credential; Merge still fills defaults |
| Move fails | Folder not reselected after import | Open Move node → pick Open Tickets / Processed |
| Silent drop | Auto-reply / self-sent filter | Check Extract `dropReason` |

---

## Security

- Use OAuth / API-key credentials only; do not paste secrets into workflow JSON  
- Restrict SharePoint/OneDrive file to the IT Support group  
- AuditLog stores subject + IDs; full bodies and AI summaries live on Tickets — treat as sensitive  
- Limit who can edit the Main workflow  

---

## Import order

1. Generate / upload Excel workbook v2.0  
2. Create Outlook folders: Open Tickets, Processed  
3. Import & activate **Error Notifier**  
4. Import **Main**  
5. Reselect folders + Excel resources  
6. Attach OpenRouter (or Groq) credential  
7. Wire Error Workflow + concurrency 1  
8. Activate Main  
9. Send a test email from a non-support address → confirm ticket row, AI columns, ack, and folder move  
10. Reply on the same thread → confirm **no** second ticket  
11. (Optional) Simulate reply failure: set `Ack Sent` to `No` on a test row and re-send on the thread → confirm resume ack  

---

## Regenerating artifacts

```bash
python scripts/generate_it_support_workbook.py
python scripts/_build_workflows.py
```
