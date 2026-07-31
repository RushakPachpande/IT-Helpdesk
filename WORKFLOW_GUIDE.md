# IT Ticketing — Workflow Guide

Production IT Helpdesk ticketing for **n8n + Microsoft Outlook + Excel (OneDrive/SharePoint)**.

This guide explains the single Main workflow, the Error Notifier companion, the Excel workbook, prerequisites, and how to debug failures.

---

## What you get

| File | Purpose |
|------|---------|
| [IT_Ticketing_Main.json](IT_Ticketing_Main.json) | **Only business workflow** — Outlook Trigger → ticket → ReplyAll → folder move |
| [IT_Ticketing_Error_Notifier.json](IT_Ticketing_Error_Notifier.json) | Alerts admin when Main fails (n8n requires Error Trigger in a separate workflow) |
| [generate_it_support_workbook.py](generate_it_support_workbook.py) | Builds the Excel workbook (tables, dropdowns, dashboard, audit log) |
| [IT Support Tickets.xlsx](IT%20Support%20Tickets.xlsx) | Generated workbook — upload to OneDrive/SharePoint |
| `ClaudeFlows/` | Previous complex design — **do not use**; kept for reference only |
| `IT Support Ticketing - v2.0.json` | Previous schedule-based flow — superseded by Main |

---

## Architecture (simple)

```text
Email arrives in IT Support Inbox
        │
        ▼
Outlook Trigger (one execution = one email)
        │
        ▼
Extract / filter (drop self-sent & auto-replies)
        │
        ├── drop ──► Move to Filtered ──► STOP
        │
        ▼
Excel lookup by ConversationID
        │
        ├── found (follow-up) ──► Move to Processed/Open Tickets ──► STOP
        │                          (no new ticket, no ack)
        ▼
Generate ticket ID  NGI-<ddmmyy>-<XXXX>
        │
        ▼
Excel lookup TicketID (retry generate up to 5× if collision)
        │
        ▼
Data Guard (required fields)
        │
        ├── invalid ──► Move to NeedsReview ──► STOP
        ▼
Excel append ticket row
        │
        ▼
Excel append AuditLog (non-blocking if this fails)
        │
        ▼
Outlook ReplyAll (HTML ack, keeps CCs on thread)
        │
        ▼
Move to Processed/Open Tickets
```

Unhandled errors anywhere → **Error Notifier** emails the admin.

**Why two workflows?** n8n’s Error Trigger cannot live inside the Main workflow. All ticket logic is still in **one** place: Main.

---

## Design decisions (and why)

### Outlook Trigger only (no Schedule)

Matches the requirement. Each new Inbox message starts one execution. Reliability comes from:

1. **Move out of Inbox** after success / follow-up / drop / invalid  
2. **ConversationID idempotency** — retries or duplicate Graph events cannot create a second ticket  
3. **Workflow concurrency = 1** — serial executions; no Excel race conditions (replaces ClaudeFlows’ lock sheet)

**Honest caveat:** Microsoft Graph webhooks can rarely miss an event. If that appears in production, add a thin reconciliation later. It is intentionally **out of v1** so the system stays debuggable.

### New vs follow-up

**Primary key:** Excel `ConversationID` (Outlook conversation id).

- Same thread → existing ticket → move only, no ack, no new row  
- New conversation → create ticket  

Subject matching `NGI-…` is not required for correctness; ConversationID is the source of truth.

### Ticket ID format

```text
NGI-<ddmmyy>-<XXXX>
```

Example: `NGI-310726-A7K9`

- `XXXX` = random A–Z / 0–9  
- Before write: Excel lookup on `TicketID`; on hit, regenerate (max 5 attempts)  
- With concurrency 1, collisions are extremely rare  

### Order of operations (partial failure safety)

1. Write Excel row **first**  
2. ReplyAll  
3. Move folder  

| Failure point | Result | Recovery |
|---------------|--------|----------|
| Excel fails | No ticket, no reply; email still in Inbox | Error alert; Graph may retry; or manual reprocess |
| Reply fails after Excel | Ticket exists; user got no ack | Error alert; ConversationID blocks duplicate; manual reply possible |
| Move fails after reply | Ticket + ack done; mail still in Inbox | Error alert; next same-conversation mail is treated as follow-up |

### CC handling

Extract stores `ccEmails`. Ack uses Outlook **ReplyAll**, so original CCs stay on the thread.

### Concurrency

Set Main → Settings → **Concurrency = 1**.

n8n may receive many trigger events at once; they queue. Each execution is isolated; Excel writes never overlap. That satisfies “Email A must never get Email B’s ticket ID” without a lock table.

---

## Prerequisites (ops checklist)

### 1. n8n & Microsoft

- [ ] n8n instance with a **public HTTPS URL** (required for Outlook Trigger / Graph webhooks)  
- [ ] Credential: **Microsoft Outlook OAuth2** on the IT Support mailbox (`IT Support Microsoft Outlook`)  
- [ ] Credential: **Microsoft Excel OAuth2** for the same account’s OneDrive/SharePoint (`IT Support NGI Microsoft Excel`)  

### 2. Outlook folders

Create under the IT Support mailbox:

```text
Inbox
Filtered
NeedsReview
Processed
 ├── Open Tickets
 ├── Pending
 └── Closed
Archive
 └── Archived Tickets
```

| Folder | Used by workflow | Purpose |
|--------|------------------|---------|
| Inbox | Trigger source | New requests |
| Filtered | Auto | Self-sent / OOO / bounce drops |
| NeedsReview | Auto | Invalid / missing data |
| Processed/Open Tickets | Auto | Created tickets + follow-ups |
| Pending / Closed / Archive | Humans | Ops lifecycle |

After import, open **every Move node** and reselect the folder (IDs are tenant-specific).

### 3. Excel workbook

```bash
python generate_it_support_workbook.py
# or overwrite a renamed copy:
python generate_it_support_workbook.py --output "IT Support Tickets NGI.xlsx"
```

Upload `IT Support Tickets.xlsx` (or your renamed copy) to the IT Support OneDrive/SharePoint.

**Note:** Dashboard/Reports use `Tickets!` cell ranges (not structured table refs) to avoid `#REF!` in Excel Online. `CreatedDate` / `ClosedDate` are real Excel dates; age/SLA formulas use named cells `SLA_High` / `SLA_Medium` / `SLA_Low`. Excel table names cannot contain spaces, so the Tickets table is named `ITTickets` (no underscore).

Sheets:

| Sheet | Purpose |
|-------|---------|
| Dashboard | Counts, charts, engineer workload |
| Tickets | Table `ITTickets` — source of truth |
| Configuration | Prefix, SLA hours, admin email, ack text |
| Categories | Dropdown list |
| Users | Engineers + named ranges for Status/Priority/etc. |
| Audit Log | Table `AuditLog` |
| Reports | Category / department stats |

In every Excel node, reselect:

- Workbook: `IT Support Tickets`  
- Worksheet/table: `Tickets` / `ITTickets`  
- Audit: `Audit Log` / `AuditLog`  

### 4. Wire Error Notifier

1. Import & **activate** `IT Ticketing - Error Notifier`  
2. Main → Settings → **Error Workflow** → select Error Notifier  
3. Update **toRecipients** (`it-admin@nextgeninnov8.com` placeholder)  

### 5. Main settings

- [ ] Concurrency = **1**  
- [ ] Save successful & failed executions (debugging)  
- [ ] Confirm Extract node self-send filter matches your mailbox  
- [ ] Activate Main  

---

## Node-by-node (Main)

| # | Node | What it does | If it fails / how to debug |
|---|------|--------------|----------------------------|
| 1 | Outlook Trigger - New Mail | Fires on new Inbox mail | Never fires → n8n not publicly reachable, wrong mailbox credential, or trigger event misconfigured |
| 2 | Extract, Filter & Prioritize | Flattens Graph message; sets `shouldProcess`, priority, CCs | Check output JSON: `messageId`, `conversationId`, `senderEmail` |
| 3 | IF - Should Process? | Routes drops | False → Filtered path |
| 4 | Move - Dropped to Filtered | Removes noise from Inbox | Folder ID wrong if move fails |
| 5 | Excel - Lookup by ConversationID | `alwaysOutputData: true` | Empty match = new ticket; wrong table/column names break dedupe |
| 6 | Check If Ticket Exists | Sets `ticketExists` | Inspect `TicketID` / `ConversationID` on lookup output |
| 7 | IF - Ticket Already Exists? | Follow-up vs new | True = follow-up |
| 8 | Move - Follow-up to Open Tickets | No second ticket | — |
| 9 | Generate Ticket ID | `NGI-ddmmyy-XXXX` + dates | Wrong format here = prompt violation |
| 10 | Excel - Lookup TicketID | Uniqueness | — |
| 11 | Check Ticket ID Collision | `needsRetry` / `idExhausted` | Exhausted → Data Guard fails → NeedsReview |
| 12 | IF - ID Collision Retry? | True → back to Generate | Loop max 5 |
| 13 | Data Guard Validation | Required fields | `validationErrors` in output |
| 14 | IF - Valid Ticket Data? | Create vs NeedsReview | — |
| 15 | Move - Invalid to NeedsReview | Manual triage | — |
| 16 | Excel - Create Ticket Row | Appends full ticket | Column name mismatch = common failure; reselect table after new workbook |
| 17 | Excel - Audit Log Created | `continueOnFail: true` | Audit failure does not block ack |
| 18 | Prepare Reply Payload | Rebuilds reply fields from Data Guard | Throws if `messageId` missing |
| 19 | Reply to Requester (HTML) | Ack in same thread; `replyToSenderOnly=false` = Reply All (CCs kept) | Graph permission / message already moved |
| 20 | Move - Success to Open Tickets | Leaves Inbox | — |

Sticky notes on the canvas repeat Setup + Debug map.

---

## Tickets table columns (written by workflow)

`TicketID`, `CreatedDate`, `CreatedTime`, `RequesterName`, `RequesterEmail`, `CCEmails`, `Subject`, `EmailBody`, `Priority`, `Category`, `Department`, `Status`, `AssignedEngineer`, `ConversationID`, `InternetMessageID`, `ConversationIndex`, `MessageId`, `Folder`, `LastUpdated`, `ClosedDate`, `ResolutionNotes`, `InternalRemarks`, `EscalationLevel`, `Resolution`, `ClosureReason`

Defaults on create: Status=`New`, Category/Department=`Other`, AssignedEngineer=`Unassigned`, EscalationLevel=`L1`.

`TicketAgeDays` / `SLARemainingHours` are Excel formulas (not written by n8n).

---

## Error Notifier

1. Error Trigger  
2. Format Error Details (workflow name, failed node, message, link)  
3. Send Alert Email to IT Admin  

---

## Common failure modes

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Trigger never runs | No public webhook URL | Put n8n behind HTTPS reverse proxy / use n8n Cloud |
| Infinite ack loop | Self filter missing / Filtered move broken | Confirm mailbox in Extract; fix Filtered folder |
| Duplicate tickets | ConversationID column mismatch or concurrency > 1 | Reselect Excel table; set concurrency 1 |
| Excel append error | Column names differ from workbook | Regenerate workbook; reselect columns |
| Reply fails | Invalid `messageId` or message already deleted | Check Prepare Reply Payload output |
| Move fails | Folder not reselected after import | Open Move node → pick folder from list |
| Silent drop | Auto-reply / self-sent filter | Check Extract `dropReason` |

---

## Security

- Use OAuth credentials only; do not paste secrets into workflow JSON  
- Restrict SharePoint/OneDrive file to the IT Support group  
- AuditLog stores subject + IDs; full bodies live on the Tickets sheet — treat as sensitive  
- Limit who can edit the Main workflow  

---

## Requirement coverage (TicketingPrompt.md)

| Requirement | How addressed |
|-------------|---------------|
| Outlook Trigger only | Main starts with `microsoftOutlookTrigger` |
| Concurrent safety | Concurrency = 1 + ConversationID idempotency |
| Fresh vs follow-up | ConversationID lookup |
| Folder strategy | Filtered / NeedsReview / Processed/Open Tickets (+ manual Pending/Closed/Archive) |
| Ticket ID `NGI-ddmmyy-XXXX` | Generate + uniqueness loop |
| Auto ack in thread | ReplyAll HTML |
| CC preserved | ReplyAll + `CCEmails` column |
| Excel storage | Full column set in `ITTickets` |
| Follow-ups no new ticket | Exists branch → move only |
| Error handling | Error Notifier + NeedsReview + retries on Outlook/Excel nodes |
| Duplicate prevention | ConversationID + move out of Inbox + concurrency 1 |
| Excel workbook / validation / dashboard | `generate_it_support_workbook.py` |
| Maintainable single flow | ~20 logic nodes, linear, documented here |

---

## Import order

1. Generate / upload Excel workbook  
2. Import & activate **Error Notifier**  
3. Import **Main**  
4. Reselect folders + Excel resources  
5. Wire Error Workflow + concurrency 1  
6. Activate Main  
7. Send a test email from a non-support address → confirm ticket row, ack, and folder move  
8. Reply on the same thread → confirm **no** second ticket  
