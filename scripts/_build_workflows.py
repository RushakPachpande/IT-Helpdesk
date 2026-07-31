#!/usr/bin/env python3
"""Build IT_Ticketing_Main.json and IT_Ticketing_Error_Notifier.json.

Fault-tolerant Main flow:
  Outlook Trigger → filter → ConversationID lookup →
    existing + Ack Sent=Yes → move Open Tickets
    existing + Ack Sent≠Yes → resume reply → update ack → move → complete
    new → ID → guard → AI summarize → create → audit → reply → ack → move → complete
"""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
WORKFLOWS_DIR = ROOT.parent / "workflows"

OUTLOOK_CRED = {
    "microsoftOutlookOAuth2Api": {
        "id": "7uyBvNQLSjMWB4rC",
        "name": "IT Support Microsoft Outlook",
    }
}
EXCEL_CRED = {
    "microsoftExcelOAuth2Api": {
        "id": "Sywc766oDseuUQUg",
        "name": "IT Support NGI Microsoft Excel",
    }
}

# Default workbook id — reselect in n8n after upload (tenant-specific).
# Live mailbox copy used in testing: IT Support Tickets (n8n).xlsx
WORKBOOK_ITEM_ID = "01RDI7SPZ5NALW6MM43VDY4JR34FTZBMSF"
WORKBOOK = {
    "__rl": True,
    "value": WORKBOOK_ITEM_ID,
    "mode": "list",
    "cachedResultName": "IT Support Tickets (n8n)",
    "cachedResultUrl": (
        "https://asmeduorg-my.sharepoint.com/personal/itsupport_nextgeninnov8_com/"
        "_layouts/15/Doc.aspx?sourcedoc=%7B6F17683D-9C31-47DD-8E26-3BE16790B245%7D"
        "&file=IT%20Support%20Tickets%20(n8n).xlsx&action=default&mobileredirect=true&DefaultItemOpen=1"
    ),
}
WS_TICKETS = {
    "__rl": True,
    "value": "{00000000-0001-0000-0100-000000000000}",
    "mode": "list",
    "cachedResultName": "Tickets",
}
TBL_TICKETS = {
    "__rl": True,
    "value": "{00000000-000C-0000-FFFF-FFFF00000000}",
    "mode": "list",
    "cachedResultName": "ITTickets",
}
WS_AUDIT = {
    "__rl": True,
    "value": "",
    "mode": "list",
    "cachedResultName": "Audit Log",
}
TBL_AUDIT = {
    "__rl": True,
    "value": "",
    "mode": "list",
    "cachedResultName": "AuditLog",
}

# Tenant-specific folder IDs — reselect Open Tickets / Processed after creating folders
FOLDER_PROCESSED = {
    "__rl": True,
    "value": "AQMkADg1YzU0ZDliLTUxNWItNDA0Yi1iMWMzLTFmN2YyZTIzNDZjYwAALgAAA8BXGtiWaUtMrakyzw4cBCcBACiz4DB5C1xLi-DdZ9AT76kAAAJhqgAAAA==",
    "mode": "list",
    "cachedResultName": "Processed",
}
FOLDER_OPEN_TICKETS = {
    "__rl": True,
    "value": "",
    "mode": "list",
    "cachedResultName": "Open Tickets  <-- RESELECT AFTER CREATING FOLDER",
}

AI_SUMMARIZE_PROMPT = (
    "You are an IT Support Assistant.\\n\\n"
    "Analyze the following email subject and body.\\n\\n"
    "Generate a concise summary (2–3 sentences) for an IT Engineer or IT Administrator.\\n\\n"
    "Focus only on the actual technical issue. "
    "Ignore greetings, signatures, and unnecessary details. "
    "Default the priority to Medium unless the email clearly indicates otherwise. "
    "Keep the output concise, factual, and easy to understand.\\n\\n"
    "Email Content\\n\\n"
    "Subject:\\n{{ $json.subject }}\\n\\n"
    "Body:\\n{{ $json.bodyPreview }}"
)


def extract_code() -> str:
    return r'''// ============================================================
// Extract, Filter & Prioritize — one Graph message → one item
// ============================================================
const item = $input.first().json;

const SELF_SENDER_MATCHES = [
  "itsupport@nextgeninnov8.com",
  "itsupport_nextgeninnov8_com"
];

const AUTO_REPLY_SUBJECT_PREFIXES = [
  "automatic reply:",
  "auto:",
  "out of office",
  "undeliverable:",
  "read:",
  "delivery status notification",
  "mail delivery failed"
];

const HIGH_PRIORITY_KEYWORDS = [
  "urgent", "asap", "critical", "down", "outage", "emergency",
  "not working", "cannot work", "can't work", "blocked",
  "security breach", "breach", "data loss", "production down",
  "server down", "cannot access", "can't access"
];

const LOW_PRIORITY_KEYWORDS = [
  "whenever", "no rush", "minor", "question", "inquiry",
  "when you get a chance", "low priority", "just curious", "fyi"
];

function detectPriority(subject, body) {
  const text = `${subject} ${body}`.toLowerCase();
  if (HIGH_PRIORITY_KEYWORDS.some((k) => text.includes(k))) return "High";
  if (LOW_PRIORITY_KEYWORDS.some((k) => text.includes(k))) return "Low";
  return "Medium";
}

function isSelfSent(senderEmail) {
  const lower = (senderEmail || "").toLowerCase();
  return SELF_SENDER_MATCHES.some((s) => lower.includes(s.toLowerCase()));
}

function isAutoReply(subject) {
  const lower = (subject || "").trim().toLowerCase();
  return AUTO_REPLY_SUBJECT_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

function extractAddress(obj) {
  if (!obj) return "";
  if (typeof obj === "string") return obj;
  const ea = obj.emailAddress || obj;
  if (typeof ea === "string") return ea;
  return ea.address || ea.email || obj.address || "";
}

function extractName(obj, email) {
  if (!obj) return "";
  const ea = obj.emailAddress || obj;
  let name = "";
  if (typeof ea === "object") name = ea.name || obj.name || "";
  if (!name || name.trim() === "" || name === email) {
    if (email && email.includes("@")) {
      return email.split("@")[0]
        .replace(/[._-]/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase());
    }
    return "Valued User";
  }
  return name;
}

const fromObj = item.from || item.sender || {};
const senderEmail = extractAddress(fromObj);
const senderName = extractName(fromObj, senderEmail);

let shouldProcess = true;
let dropReason = "";
if (isSelfSent(senderEmail)) {
  shouldProcess = false;
  dropReason = "self_sent";
} else if (isAutoReply(item.subject)) {
  shouldProcess = false;
  dropReason = "auto_reply";
}

let rawBody = item.bodyPreview || (item.body && item.body.content) || "";
let cleanedBody = String(rawBody)
  .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
  .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
  .replace(/<[^>]*>/g, "")
  .replace(/\r\n/g, "\n")
  .replace(/\r/g, "\n")
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line.length > 0)
  .join("\n\n");
if (cleanedBody.length > 1500) cleanedBody = cleanedBody.substring(0, 1497) + "...";

const ccList = [];
const ccRaw = item.ccRecipients || item.cc || [];
if (Array.isArray(ccRaw)) {
  for (const r of ccRaw) {
    const addr = extractAddress(r);
    if (addr) ccList.push(addr);
  }
}

const conversationIndex =
  item.conversationIndex ||
  (item.internetMessageHeaders || [])
    .find((h) => (h.name || "").toLowerCase() === "thread-index")?.value ||
  "";

const priority = detectPriority(item.subject || "", cleanedBody);

return [{
  json: {
    messageId: item.id || "",
    conversationId: item.conversationId || "",
    internetMessageId: item.internetMessageId || "",
    conversationIndex,
    subject: item.subject || "(no subject)",
    senderName,
    senderEmail,
    ccEmails: ccList.join(", "),
    bodyPreview: cleanedBody || "(no content)",
    receivedDateTime: item.receivedDateTime || item.createdDateTime || "",
    priority,
    shouldProcess,
    dropReason,
    folderLabel: "Open Tickets"
  }
}];
'''


def check_exists_code() -> str:
    return r'''const matchItem = $input.first();
// Use .first() not .item — Excel lookup breaks pairedItem linking
const currentEmail = $('Extract, Filter & Prioritize').first().json;
const row = (matchItem && matchItem.json) ? matchItem.json : {};

const ticketId = row["Ticket ID"] || row.TicketID || null;
const conversationId = row["Conversation ID"] || row.ConversationID || null;
const ticketExists = Boolean(ticketId || conversationId);
const ackRaw = row["Ack Sent"] || row.AckSent || "";
const ackSent = String(ackRaw).trim().toLowerCase() === "yes";
const processingStage = row["Processing Stage"] || row.ProcessingStage || "";

return [{
  json: {
    ...currentEmail,
    ticketExists,
    existingTicketId: ticketId,
    existingAckSent: ackSent,
    existingProcessingStage: processingStage,
    existingSubject: row.Subject || row.subject || currentEmail.subject,
    existingPriority: row.Priority || row.priority || currentEmail.priority,
    existingRequesterName: row["Requester Name"] || row.RequesterName || currentEmail.senderName,
    existingCreatedDate: row["Created Date"] || row.CreatedDate || "",
    existingCreatedTime: row["Created Time"] || row.CreatedTime || ""
  }
}];
'''


def generate_ticket_id_code() -> str:
    return r'''const prev = $input.first().json;
// Prefer email payload carried on the item; on collision retry, payload is forwarded.
// Never use .item here — pairedItem breaks after Excel / IF branches.
const base = prev.messageId
  ? prev
  : $('Extract, Filter & Prioritize').first().json;

const attempt = (prev.idAttempt || 0) + 1;
const MAX_ATTEMPTS = 5;

const now = new Date();
const dd = String(now.getDate()).padStart(2, "0");
const mm = String(now.getMonth() + 1).padStart(2, "0");
const yy = String(now.getFullYear()).slice(-2);

const charset = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
let suffix = "";
for (let i = 0; i < 4; i++) {
  suffix += charset[Math.floor(Math.random() * charset.length)];
}

const ticketId = `NGI-${dd}${mm}${yy}-${suffix}`;

const createdDate = `${dd}-${mm}-${now.getFullYear()}`;
const createdTime = now.toLocaleTimeString("en-US", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: true,
  timeZone: "Asia/Kolkata"
});
const lastUpdated = now.toLocaleString("en-GB", { timeZone: "Asia/Kolkata" });

return [{
  json: {
    ...base,
    ticketId,
    candidateTicketId: ticketId,
    idAttempt: attempt,
    maxIdAttempts: MAX_ATTEMPTS,
    createdDate,
    createdTime,
    lastUpdated
  }
}];
'''


def check_collision_code() -> str:
    return r'''const lookup = $input.first().json || {};
const candidate = $('Generate Ticket ID').first().json;

const collision = Boolean(
  lookup["Ticket ID"] || lookup.TicketID || lookup.ticketId
);

const exhausted = collision && candidate.idAttempt >= candidate.maxIdAttempts;

return [{
  json: {
    ...candidate,
    idCollision: collision,
    idExhausted: exhausted,
    // When unique, proceed; when collision and not exhausted, retry generate
    needsRetry: collision && !exhausted
  }
}];
'''


def data_guard_code() -> str:
    return r'''const item = $input.first().json;
const errors = [];

if (!item.ticketId) errors.push("Missing ticketId");
if (!item.senderEmail || !String(item.senderEmail).includes("@")) errors.push("Invalid senderEmail");
if (!item.messageId) errors.push("Missing messageId");
if (!item.conversationId) errors.push("Missing conversationId");
if (!item.subject) errors.push("Missing subject");
if (item.idExhausted) errors.push("Ticket ID collision retries exhausted");

return [{
  json: {
    ...item,
    isValid: errors.length === 0,
    validationErrors: errors.join("; ")
  }
}];
'''


def merge_ai_summary_code() -> str:
    return r'''// Merge Structured Output Parser / LLM result with ticket payload.
// continueOnFail on AI means we may only have the previous Data Guard item.
const guard = $('Data Guard Validation').first().json;
const aiItem = $input.first().json || {};

function pick(...vals) {
  for (const v of vals) {
    if (v !== undefined && v !== null && String(v).trim() !== "") return String(v).trim();
  }
  return "";
}

const body = String(guard.bodyPreview || "");
const defaultIssue = body.length > 220 ? body.substring(0, 217) + "..." : (body || guard.subject || "No summary available");
const defaultPriority = guard.priority || "Medium";
const defaultScope = guard.senderName
  ? `${guard.senderName} <${guard.senderEmail || ""}>`
  : (guard.senderEmail || "Unknown");

// Structured parser may nest under output / json / top-level
const nested = aiItem.output || aiItem.json || aiItem;
const issue = pick(nested.issue, aiItem.issue, nested["AI Issue Summary"]);
const aiPriority = pick(nested.priority, aiItem.priority, nested["AI Priority"]);
const scope = pick(nested.scope, aiItem.scope, nested["AI Scope"]);

const allowed = new Set(["Low", "Medium", "High", "Critical"]);
const normalizedPriority = allowed.has(aiPriority)
  ? aiPriority
  : (allowed.has(defaultPriority) ? defaultPriority : "Medium");

return [{
  json: {
    ...guard,
    aiIssueSummary: issue || defaultIssue,
    aiPriority: normalizedPriority,
    aiScope: scope || defaultScope,
    aiUsedFallback: !(issue && scope)
  }
}];
'''


def prepare_reply_code() -> str:
    return r'''// After Excel append/update nodes, $json is often the Excel API response — not our ticket.
// pairedItem is often undefined across Excel nodes, so NEVER use $('Node').item here.
const merge = $('Merge AI Summary').first().json;

const messageId = String(merge.messageId || "").trim();
if (!messageId) {
  throw new Error(`Missing valid Outlook messageId for reply. Received: ${JSON.stringify(merge.messageId)}`);
}

return [{
  json: {
    messageId,
    conversationId: merge.conversationId,
    internetMessageId: merge.internetMessageId,
    ticketId: merge.ticketId,
    senderName: merge.senderName || "Valued User",
    senderEmail: merge.senderEmail || "",
    ccEmails: merge.ccEmails || "",
    subject: merge.subject || "(no subject)",
    priority: merge.priority || "Medium",
    createdDate: merge.createdDate,
    createdTime: merge.createdTime
  }
}];
'''


def prepare_resume_reply_code() -> str:
    return r'''const item = $input.first().json;
const messageId = String(item.messageId || "").trim();
if (!messageId) {
  throw new Error("Missing messageId for resume ack reply");
}
const ticketId = item.existingTicketId;
if (!ticketId) {
  throw new Error("Missing existingTicketId for resume ack");
}

const now = new Date();
const createdDate = item.existingCreatedDate || now.toLocaleDateString("en-GB");
const createdTime = item.existingCreatedTime || now.toLocaleTimeString("en-US", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: true,
  timeZone: "Asia/Kolkata"
});

return [{
  json: {
    messageId,
    conversationId: item.conversationId,
    internetMessageId: item.internetMessageId,
    ticketId,
    senderName: item.existingRequesterName || item.senderName || "Valued User",
    senderEmail: item.senderEmail || "",
    ccEmails: item.ccEmails || "",
    subject: item.existingSubject || item.subject || "(no subject)",
    priority: item.existingPriority || item.priority || "Medium",
    createdDate,
    createdTime,
    resumeAck: true
  }
}];
'''


def prepare_invalid_row_code() -> str:
    return r'''const item = $input.first().json;
const now = new Date();
const lastUpdated = now.toLocaleString("en-GB", { timeZone: "Asia/Kolkata" });
return [{
  json: {
    ...item,
    lastUpdated,
    status: "Needs Review",
    processingStage: "NeedsReview",
    ackSent: "No",
    aiIssueSummary: item.validationErrors || "Validation failed",
    aiPriority: item.priority || "Medium",
    aiScope: item.senderEmail || "",
    folderLabel: "Open Tickets",
    internalRemarks: `Validation: ${item.validationErrors || "unknown"}`
  }
}];
'''


REPLY_HTML = (
    '=<div style="font-family: \'Segoe UI\', Helvetica, Arial, sans-serif; background-color: #f4f6f9; '
    'padding: 20px; color: #333333;">\n'
    '  <div style="max-width: 580px; margin: 0 auto; background: #ffffff; border-radius: 8px; '
    'overflow: hidden; border: 1px solid #e2e8f0; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.05);">\n'
    '    <div style="background-color: #0056b3; padding: 20px 25px; color: #ffffff;">\n'
    '      <h2 style="margin: 0; font-size: 20px; font-weight: 600;">IT Support Request Received</h2>\n'
    "    </div>\n"
    '    <div style="padding: 25px;">\n'
    '      <p style="font-size: 15px; line-height: 1.5; margin-top: 0;">Dear <strong>{{ $json.senderName }}</strong>,</p>\n'
    '      <p style="font-size: 14px; color: #555555; line-height: 1.5;">Thank you for reaching out. '
    "We have logged a new support ticket for your request.</p>\n"
    '      <div style="background-color: #f8fafc; border-left: 4px solid #0056b3; padding: 15px 20px; '
    'margin: 20px 0; border-radius: 0 6px 6px 0;">\n'
    '        <table style="width: 100%; border-collapse: collapse; font-size: 14px;">\n'
    "          <tr>\n"
    '            <td style="padding: 4px 0; color: #64748b; width: 110px;"><strong>Ticket ID:</strong></td>\n'
    '            <td style="padding: 4px 0; font-weight: 700; color: #0056b3;">{{ $json.ticketId }}</td>\n'
    "          </tr>\n"
    "          <tr>\n"
    '            <td style="padding: 4px 0; color: #64748b;"><strong>Subject:</strong></td>\n'
    '            <td style="padding: 4px 0; color: #1e293b;">{{ $json.subject }}</td>\n'
    "          </tr>\n"
    "          <tr>\n"
    '            <td style="padding: 4px 0; color: #64748b;"><strong>Status:</strong></td>\n'
    '            <td style="padding: 4px 0;"><span style="background-color: #dbeafe; color: #1e40af; '
    'padding: 2px 8px; border-radius: 12px; font-size: 12px; font-weight: 600;">NEW</span></td>\n'
    "          </tr>\n"
    "          <tr>\n"
    '            <td style="padding: 4px 0; color: #64748b;"><strong>Priority:</strong></td>\n'
    '            <td style="padding: 4px 0; color: #1e293b;">{{ $json.priority }}</td>\n'
    "          </tr>\n"
    "          <tr>\n"
    '            <td style="padding: 4px 0; color: #64748b;"><strong>Received:</strong></td>\n'
    '            <td style="padding: 4px 0; color: #1e293b;">{{ $now.toFormat(\'dd-MM-yyyy hh:mm a\') }}</td>\n'
    "          </tr>\n"
    "        </table>\n"
    "      </div>\n"
    '      <p style="font-size: 14px; color: #555555; line-height: 1.5;">Our support team is reviewing '
    "your request and will follow up with you on this thread within 1 business day. "
    "Please reply on this email thread for any updates related to this ticket.</p>\n"
    '      <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 25px 0 15px 0;" />\n'
    '      <p style="font-size: 13px; color: #64748b; margin: 0; line-height: 1.4;">\n'
    "        Best regards,<br>\n"
    '        <strong style="color: #1e293b;">Rushak Pachpande</strong><br>\n'
    "        NGI IT Support Team\n"
    "      </p>\n"
    "    </div>\n"
    "  </div>\n"
    "</div>"
)


def if_bool(condition_id: str, left_expr: str) -> dict:
    return {
        "conditions": {
            "options": {
                "caseSensitive": True,
                "leftValue": "",
                "typeValidation": "strict",
                "version": 2,
            },
            "conditions": [
                {
                    "id": condition_id,
                    "leftValue": left_expr,
                    "rightValue": True,
                    "operator": {
                        "type": "boolean",
                        "operation": "true",
                        "singleValue": True,
                    },
                }
            ],
            "combinator": "and",
        },
        "options": {},
    }


def move_node(node_id: str, name: str, message_expr: str, folder: dict, pos: list[int]) -> dict:
    return {
        "parameters": {
            "resource": "message",
            "operation": "move",
            "messageId": {"__rl": True, "value": message_expr, "mode": "id"},
            "folderId": folder,
        },
        "id": node_id,
        "name": name,
        "type": "n8n-nodes-base.microsoftOutlook",
        "typeVersion": 2,
        "position": pos,
        "credentials": OUTLOOK_CRED,
        "retryOnFail": True,
        "maxTries": 2,
        "waitBetweenTries": 2000,
    }


def excel_lookup(node_id: str, name: str, column: str, value_expr: str, pos: list[int]) -> dict:
    return {
        "parameters": {
            "resource": "table",
            "operation": "lookup",
            "workbook": WORKBOOK,
            "worksheet": WS_TICKETS,
            "table": TBL_TICKETS,
            "lookupColumn": column,
            "lookupValue": value_expr,
            "options": {"returnAllMatches": True},
        },
        "id": node_id,
        "name": name,
        "type": "n8n-nodes-base.microsoftExcel",
        "typeVersion": 2.2,
        "position": pos,
        "alwaysOutputData": True,
        "credentials": EXCEL_CRED,
        "retryOnFail": True,
        "maxTries": 3,
        "waitBetweenTries": 2000,
    }


def resolve_stage_patch_code(*, ticket_id_expr_source: str, mode: str) -> str:
    """Build Code that maps Ticket ID → Excel row and Graph range PATCH bodies.

    Official n8n Microsoft Excel Table ops do NOT include update (docs:
    append / getRows / getColumns / lookup only). Stage flags are written via
    Microsoft Graph range update + HTTP Request + Excel OAuth (n8n custom API docs).

    Column letters match generate_it_support_workbook.py TICKET_COLUMNS:
      R=Folder, S=Last Updated, Z=Processing Stage, AA=Ack Sent

    Emits a SINGLE item with patchA + patchB so Move is not duplicated.
    """
    assert mode in ("ack", "complete")
    if mode == "ack":
        patches_js = r'''
  // Z=Processing Stage, AA=Ack Sent; S=Last Updated
  return [{
    json: {
      ticketId,
      excelRow,
      patchA: {
        graphUrl: `${base}/range(address='Z${excelRow}:AA${excelRow}')`,
        patchBody: { values: [["Acked", "Yes"]] }
      },
      patchB: {
        graphUrl: `${base}/range(address='S${excelRow}')`,
        patchBody: { values: [[lastUpdated]] }
      }
    }
  }];'''
    else:
        patches_js = r'''
  // R=Folder, S=Last Updated; Z=Processing Stage
  return [{
    json: {
      ticketId,
      excelRow,
      patchA: {
        graphUrl: `${base}/range(address='R${excelRow}:S${excelRow}')`,
        patchBody: { values: [["Open Tickets", lastUpdated]] }
      },
      patchB: {
        graphUrl: `${base}/range(address='Z${excelRow}')`,
        patchBody: { values: [["Complete"]] }
      }
    }
  }];'''

    return f'''// Resolve Excel row for Ticket ID, then emit Graph range PATCH payloads.
// Table getRows order matches table row index (0-based). Header is Excel row 1.
const ticketId = String($('{ticket_id_expr_source}').first().json.ticketId || "").trim();
if (!ticketId) {{
  throw new Error("Missing ticketId for stage patch");
}}

const workbookId = "{WORKBOOK_ITEM_ID}";
const rows = $input.all();
let tableIndex = -1;
for (let i = 0; i < rows.length; i++) {{
  const row = rows[i].json || {{}};
  const id = row["Ticket ID"] || row.TicketID || "";
  if (String(id).trim() === ticketId) {{
    tableIndex = i;
    break;
  }}
}}
if (tableIndex < 0) {{
  throw new Error(`Ticket ID not found in ITTickets table: ${{ticketId}}`);
}}

const excelRow = tableIndex + 2; // row 1 = header
const lastUpdated = new Date().toLocaleString("en-GB", {{ timeZone: "Asia/Kolkata" }});
const base = `https://graph.microsoft.com/v1.0/me/drive/items/${{workbookId}}/workbook/worksheets('Tickets')`;
{patches_js}
'''


def _http_graph_patch_node(
    *,
    node_id: str,
    name: str,
    url_expr: str,
    body_expr: str,
    pos: list[int],
) -> dict:
    return {
        "parameters": {
            "method": "PATCH",
            "url": url_expr,
            "authentication": "predefinedCredentialType",
            "nodeCredentialType": "microsoftExcelOAuth2Api",
            "sendBody": True,
            "specifyBody": "json",
            "jsonBody": body_expr,
            "options": {},
        },
        "id": node_id,
        "name": name,
        "type": "n8n-nodes-base.httpRequest",
        "typeVersion": 4.2,
        "position": pos,
        "credentials": EXCEL_CRED,
        "retryOnFail": True,
        "maxTries": 3,
        "waitBetweenTries": 2000,
    }


def excel_stage_patch_chain(
    *,
    prefix: str,
    get_rows_name: str,
    resolve_name: str,
    http_a_name: str,
    http_b_name: str,
    ticket_source_node: str,
    mode: str,
    pos_get: list[int],
    pos_resolve: list[int],
    pos_http_a: list[int],
    pos_http_b: list[int],
) -> list[dict]:
    """Replace unsupported table:update with getRows → resolve → 2× Graph HTTP PATCH."""
    get_rows = {
        "parameters": {
            "resource": "table",
            "operation": "getRows",
            "workbook": WORKBOOK,
            "worksheet": WS_TICKETS,
            "table": TBL_TICKETS,
            "returnAll": True,
            "rawData": False,
            "filters": {},
        },
        "id": f"{prefix}-get-rows",
        "name": get_rows_name,
        "type": "n8n-nodes-base.microsoftExcel",
        "typeVersion": 2.2,
        "position": pos_get,
        "credentials": EXCEL_CRED,
        "retryOnFail": True,
        "maxTries": 3,
        "waitBetweenTries": 2000,
    }
    resolve = {
        "parameters": {
            "mode": "runOnceForAllItems",
            "jsCode": resolve_stage_patch_code(
                ticket_id_expr_source=ticket_source_node,
                mode=mode,
            )
        },
        "id": f"{prefix}-resolve",
        "name": resolve_name,
        "type": "n8n-nodes-base.code",
        "typeVersion": 2,
        "position": pos_resolve,
    }
    http_a = _http_graph_patch_node(
        node_id=f"{prefix}-http-a",
        name=http_a_name,
        url_expr="={{ $json.patchA.graphUrl }}",
        body_expr="={{ JSON.stringify($json.patchA.patchBody) }}",
        pos=pos_http_a,
    )
    http_b = _http_graph_patch_node(
        node_id=f"{prefix}-http-b",
        name=http_b_name,
        # After first HTTP, $json is Graph response — read Resolve node
        url_expr=f"={{{{ $('{resolve_name}').first().json.patchB.graphUrl }}}}",
        body_expr=(
            f"={{{{ JSON.stringify($('{resolve_name}').first().json.patchB.patchBody) }}}}"
        ),
        pos=pos_http_b,
    )
    return [get_rows, resolve, http_a, http_b]


def ticket_create_fields(*, status: str, stage: str, ack: str, source_node: str) -> list[dict]:
    """Field map for Excel append. source_node expressions use $('Name').first().json."""
    j = f"$('{source_node}').first().json"
    return [
        {"column": "Ticket ID", "fieldValue": f"={{{{ {j}.ticketId }}}}"},
        {"column": "Created Date", "fieldValue": f"={{{{ {j}.createdDate }}}}"},
        {"column": "Created Time", "fieldValue": f"={{{{ {j}.createdTime }}}}"},
        {"column": "Requester Name", "fieldValue": f"={{{{ {j}.senderName }}}}"},
        {"column": "Requester Email", "fieldValue": f"={{{{ {j}.senderEmail }}}}"},
        {"column": "CC Emails", "fieldValue": f"={{{{ {j}.ccEmails }}}}"},
        {"column": "Subject", "fieldValue": f"={{{{ {j}.subject }}}}"},
        {"column": "Email Body", "fieldValue": f"={{{{ {j}.bodyPreview }}}}"},
        {"column": "Priority", "fieldValue": f"={{{{ {j}.priority }}}}"},
        {"column": "Category", "fieldValue": "Other"},
        {"column": "Department", "fieldValue": "Other"},
        {"column": "Status", "fieldValue": status},
        {"column": "Assigned Engineer", "fieldValue": "Unassigned"},
        {"column": "Conversation ID", "fieldValue": f"={{{{ {j}.conversationId }}}}"},
        {"column": "Internet Message ID", "fieldValue": f"={{{{ {j}.internetMessageId }}}}"},
        {"column": "Conversation Index", "fieldValue": f"={{{{ {j}.conversationIndex }}}}"},
        {"column": "Message Id", "fieldValue": f"={{{{ {j}.messageId }}}}"},
        {"column": "Folder", "fieldValue": "Open Tickets"},
        {"column": "Last Updated", "fieldValue": f"={{{{ {j}.lastUpdated }}}}"},
        {"column": "Closed Date", "fieldValue": ""},
        {"column": "Resolution Notes", "fieldValue": ""},
        {
            "column": "Internal Remarks",
            "fieldValue": f"={{{{ {j}.internalRemarks || '' }}}}",
        },
        {"column": "Escalation Level", "fieldValue": "L1"},
        {"column": "Resolution", "fieldValue": ""},
        {"column": "Closure Reason", "fieldValue": ""},
        {"column": "Processing Stage", "fieldValue": stage},
        {"column": "Ack Sent", "fieldValue": ack},
        {
            "column": "AI Issue Summary",
            "fieldValue": f"={{{{ {j}.aiIssueSummary || '' }}}}",
        },
        {
            "column": "AI Priority",
            "fieldValue": f"={{{{ {j}.aiPriority || {j}.priority || 'Medium' }}}}",
        },
        {"column": "AI Scope", "fieldValue": f"={{{{ {j}.aiScope || '' }}}}"},
    ]


def reply_node(node_id: str, name: str, message_id_expr: str, pos: list[int]) -> dict:
    return {
        "parameters": {
            # Outlook v2 has no "replyAll" operation — that crashes the router.
            # Use reply + replyToSenderOnly=false → Graph createReplyAll (keeps CCs).
            "resource": "message",
            "operation": "reply",
            "replyToSenderOnly": False,
            "messageId": {
                "__rl": True,
                "value": message_id_expr,
                "mode": "id",
            },
            "message": REPLY_HTML,
            "options": {},
        },
        "id": node_id,
        "name": name,
        "type": "n8n-nodes-base.microsoftOutlook",
        "typeVersion": 2,
        "position": pos,
        "credentials": OUTLOOK_CRED,
        "retryOnFail": True,
        "maxTries": 2,
        "waitBetweenTries": 3000,
    }


def build_main() -> dict:
    nodes = [
        {
            "parameters": {"event": "messageReceived", "options": {}},
            "id": "n01-trigger",
            "name": "Outlook Trigger - New Mail",
            "type": "n8n-nodes-base.microsoftOutlookTrigger",
            "typeVersion": 1,
            "position": [0, 400],
            "credentials": OUTLOOK_CRED,
            "retryOnFail": True,
            "maxTries": 4,
            "waitBetweenTries": 2000,
        },
        {
            "parameters": {"jsCode": extract_code()},
            "id": "n02-extract",
            "name": "Extract, Filter & Prioritize",
            "type": "n8n-nodes-base.code",
            "typeVersion": 2,
            "position": [260, 400],
        },
        {
            "parameters": if_bool("cond-should-process", "={{ $json.shouldProcess }}"),
            "id": "n03-if-process",
            "name": "IF - Should Process?",
            "type": "n8n-nodes-base.if",
            "typeVersion": 2.2,
            "position": [520, 400],
        },
        move_node(
            "n04-move-dropped",
            "Move - Dropped to Processed",
            "={{ $json.messageId }}",
            FOLDER_PROCESSED,
            [780, 640],
        ),
        excel_lookup(
            "n05-lookup-conv",
            "Excel - Lookup by ConversationID",
            "Conversation ID",
            "={{ $json.conversationId }}",
            [780, 280],
        ),
        {
            "parameters": {"jsCode": check_exists_code()},
            "id": "n06-check-exists",
            "name": "Check If Ticket Exists",
            "type": "n8n-nodes-base.code",
            "typeVersion": 2,
            "position": [1040, 280],
        },
        {
            "parameters": if_bool("cond-ticket-exists", "={{ $json.ticketExists }}"),
            "id": "n07-if-exists",
            "name": "IF - Ticket Already Exists?",
            "type": "n8n-nodes-base.if",
            "typeVersion": 2.2,
            "position": [1300, 280],
        },
        {
            "parameters": if_bool("cond-ack-sent", "={{ $json.existingAckSent }}"),
            "id": "n07b-if-ack",
            "name": "IF - Ack Already Sent?",
            "type": "n8n-nodes-base.if",
            "typeVersion": 2.2,
            "position": [1560, 80],
        },
        move_node(
            "n08-move-followup",
            "Move - Follow-up to Open Tickets",
            "={{ $json.messageId }}",
            FOLDER_OPEN_TICKETS,
            [1820, -40],
        ),
        {
            "parameters": {"jsCode": prepare_resume_reply_code()},
            "id": "n08a-prep-resume",
            "name": "Prepare Resume Reply",
            "type": "n8n-nodes-base.code",
            "typeVersion": 2,
            "position": [1820, 160],
        },
        reply_node(
            "n08b-resume-reply",
            "Resume Reply to Requester",
            "={{ $json.messageId }}",
            [2080, 160],
        ),
        *excel_stage_patch_chain(
            prefix="n08c",
            get_rows_name="Excel - Get Rows (Resume Ack)",
            resolve_name="Resolve Ack Patch (Resume)",
            http_a_name="HTTP - Patch Ack Stage (Resume)",
            http_b_name="HTTP - Patch Ack Timestamp (Resume)",
            ticket_source_node="Prepare Resume Reply",
            mode="ack",
            pos_get=[2340, 160],
            pos_resolve=[2500, 160],
            pos_http_a=[2660, 160],
            pos_http_b=[2820, 160],
        ),
        move_node(
            "n08d-move-resume",
            "Move - Resume to Open Tickets",
            "={{ $('Prepare Resume Reply').first().json.messageId }}",
            FOLDER_OPEN_TICKETS,
            [2980, 160],
        ),
        *excel_stage_patch_chain(
            prefix="n08e",
            get_rows_name="Excel - Get Rows (Resume Complete)",
            resolve_name="Resolve Complete Patch (Resume)",
            http_a_name="HTTP - Patch Complete Folder (Resume)",
            http_b_name="HTTP - Patch Complete Stage (Resume)",
            ticket_source_node="Prepare Resume Reply",
            mode="complete",
            pos_get=[3140, 160],
            pos_resolve=[3300, 160],
            pos_http_a=[3460, 160],
            pos_http_b=[3620, 160],
        ),
        {
            "parameters": {"jsCode": generate_ticket_id_code()},
            "id": "n09-gen-id",
            "name": "Generate Ticket ID",
            "type": "n8n-nodes-base.code",
            "typeVersion": 2,
            "position": [1560, 400],
        },
        excel_lookup(
            "n10-lookup-tid",
            "Excel - Lookup TicketID",
            "Ticket ID",
            "={{ $json.ticketId }}",
            [1820, 400],
        ),
        {
            "parameters": {"jsCode": check_collision_code()},
            "id": "n11-check-collision",
            "name": "Check Ticket ID Collision",
            "type": "n8n-nodes-base.code",
            "typeVersion": 2,
            "position": [2080, 400],
        },
        {
            "parameters": if_bool("cond-needs-retry", "={{ $json.needsRetry }}"),
            "id": "n12-if-retry",
            "name": "IF - ID Collision Retry?",
            "type": "n8n-nodes-base.if",
            "typeVersion": 2.2,
            "position": [2340, 400],
        },
        {
            "parameters": {"jsCode": data_guard_code()},
            "id": "n13-guard",
            "name": "Data Guard Validation",
            "type": "n8n-nodes-base.code",
            "typeVersion": 2,
            "position": [2600, 520],
        },
        {
            "parameters": if_bool("cond-valid", "={{ $json.isValid }}"),
            "id": "n14-if-valid",
            "name": "IF - Valid Ticket Data?",
            "type": "n8n-nodes-base.if",
            "typeVersion": 2.2,
            "position": [2860, 520],
        },
        # --- Invalid path: create Needs Review row + move Open Tickets ---
        {
            "parameters": {"jsCode": prepare_invalid_row_code()},
            "id": "n15a-prep-invalid",
            "name": "Prepare Invalid Ticket Row",
            "type": "n8n-nodes-base.code",
            "typeVersion": 2,
            "position": [3120, 760],
        },
        {
            "parameters": {
                "resource": "table",
                "operation": "append",
                "workbook": WORKBOOK,
                "worksheet": WS_TICKETS,
                "table": TBL_TICKETS,
                "fieldsUi": {
                    "values": ticket_create_fields(
                        status="Needs Review",
                        stage="NeedsReview",
                        ack="No",
                        source_node="Prepare Invalid Ticket Row",
                    )
                },
                "options": {},
            },
            "id": "n15b-create-invalid",
            "name": "Excel - Create Needs Review Row",
            "type": "n8n-nodes-base.microsoftExcel",
            "typeVersion": 2.2,
            "position": [3380, 760],
            "credentials": EXCEL_CRED,
            "retryOnFail": True,
            "maxTries": 3,
            "waitBetweenTries": 2000,
            "continueOnFail": True,
        },
        move_node(
            "n15c-move-invalid",
            "Move - Invalid to Open Tickets",
            "={{ $('Prepare Invalid Ticket Row').first().json.messageId }}",
            FOLDER_OPEN_TICKETS,
            [3640, 760],
        ),
        # --- AI summarize (valid path) ---
        {
            "parameters": {
                "promptType": "define",
                "text": f"={AI_SUMMARIZE_PROMPT}",
                "hasOutputParser": True,
                "messages": {
                    "messageValues": [
                        {
                            "type": "SystemMessagePromptTemplate",
                            "message": (
                                "You are an IT Support Assistant. Return only the structured "
                                "fields: issue, priority (Low|Medium|High|Critical), scope."
                            ),
                        }
                    ]
                },
            },
            "id": "n16-ai-chain",
            "name": "AI - Summarize Email",
            "type": "@n8n/n8n-nodes-langchain.chainLlm",
            "typeVersion": 1.7,
            "position": [3120, 400],
            "continueOnFail": True,
            "retryOnFail": True,
            "maxTries": 2,
            "waitBetweenTries": 1500,
        },
        {
            "parameters": {
                "model": "openai/gpt-4o-mini",
                "options": {},
            },
            "id": "n16a-openrouter",
            "name": "OpenRouter Chat Model",
            "type": "@n8n/n8n-nodes-langchain.lmChatOpenRouter",
            "typeVersion": 1,
            "position": [3120, 620],
            "credentials": {
                "openRouterApi": {
                    "id": "",
                    "name": "OpenRouter account  <-- ADD API KEY",
                }
            },
        },
        {
            "parameters": {
                "schemaType": "fromJson",
                "jsonSchemaExample": (
                    '{\n  "issue": "Brief summary of the actual problem",\n'
                    '  "priority": "Medium",\n'
                    '  "scope": "Affected user, application, device, or system"\n}'
                ),
            },
            "id": "n16b-parser",
            "name": "Structured Output Parser",
            "type": "@n8n/n8n-nodes-langchain.outputParserStructured",
            "typeVersion": 1.2,
            "position": [3340, 620],
        },
        {
            "parameters": {"jsCode": merge_ai_summary_code()},
            "id": "n16c-merge-ai",
            "name": "Merge AI Summary",
            "type": "n8n-nodes-base.code",
            "typeVersion": 2,
            "position": [3380, 400],
        },
        {
            "parameters": {
                "resource": "table",
                "operation": "append",
                "workbook": WORKBOOK,
                "worksheet": WS_TICKETS,
                "table": TBL_TICKETS,
                "fieldsUi": {
                    "values": ticket_create_fields(
                        status="New",
                        stage="Created",
                        ack="No",
                        source_node="Merge AI Summary",
                    )
                },
                "options": {},
            },
            "id": "n17-create",
            "name": "Excel - Create Ticket Row",
            "type": "n8n-nodes-base.microsoftExcel",
            "typeVersion": 2.2,
            "position": [3640, 400],
            "credentials": EXCEL_CRED,
            "retryOnFail": True,
            "maxTries": 3,
            "waitBetweenTries": 2000,
        },
        {
            "parameters": {
                "resource": "table",
                "operation": "append",
                "workbook": WORKBOOK,
                "worksheet": WS_AUDIT,
                "table": TBL_AUDIT,
                "fieldsUi": {
                    "values": [
                        {
                            "column": "Timestamp",
                            "fieldValue": "={{ $now.toFormat('yyyy-MM-dd HH:mm:ss') }}",
                        },
                        {"column": "Event", "fieldValue": "ticket_created"},
                        {
                            "column": "Ticket ID",
                            "fieldValue": "={{ $('Merge AI Summary').first().json.ticketId }}",
                        },
                        {
                            "column": "Conversation ID",
                            "fieldValue": "={{ $('Merge AI Summary').first().json.conversationId }}",
                        },
                        {
                            "column": "Message Id",
                            "fieldValue": "={{ $('Merge AI Summary').first().json.messageId }}",
                        },
                        {
                            "column": "Detail",
                            "fieldValue": "={{ $('Merge AI Summary').first().json.subject }}",
                        },
                    ]
                },
                "options": {},
            },
            "id": "n18-audit",
            "name": "Excel - Audit Log Created",
            "type": "n8n-nodes-base.microsoftExcel",
            "typeVersion": 2.2,
            "position": [3900, 400],
            "credentials": EXCEL_CRED,
            "continueOnFail": True,
            "retryOnFail": True,
            "maxTries": 2,
            "waitBetweenTries": 1500,
        },
        {
            "parameters": {"jsCode": prepare_reply_code()},
            "id": "n19-prep-reply",
            "name": "Prepare Reply Payload",
            "type": "n8n-nodes-base.code",
            "typeVersion": 2,
            "position": [4160, 400],
        },
        reply_node(
            "n20-reply",
            "Reply to Requester (HTML)",
            "={{ $json.messageId }}",
            [4420, 400],
        ),
        *excel_stage_patch_chain(
            prefix="n21",
            get_rows_name="Excel - Get Rows (Ack)",
            resolve_name="Resolve Ack Patch",
            http_a_name="HTTP - Patch Ack Stage",
            http_b_name="HTTP - Patch Ack Timestamp",
            ticket_source_node="Prepare Reply Payload",
            mode="ack",
            pos_get=[4680, 400],
            pos_resolve=[4840, 400],
            pos_http_a=[5000, 400],
            pos_http_b=[5160, 400],
        ),
        move_node(
            "n22-move-success",
            "Move - Success to Open Tickets",
            "={{ $('Prepare Reply Payload').first().json.messageId }}",
            FOLDER_OPEN_TICKETS,
            [5320, 400],
        ),
        *excel_stage_patch_chain(
            prefix="n23",
            get_rows_name="Excel - Get Rows (Complete)",
            resolve_name="Resolve Complete Patch",
            http_a_name="HTTP - Patch Complete Folder",
            http_b_name="HTTP - Patch Complete Stage",
            ticket_source_node="Prepare Reply Payload",
            mode="complete",
            pos_get=[5480, 400],
            pos_resolve=[5640, 400],
            pos_http_a=[5800, 400],
            pos_http_b=[5960, 400],
        ),
        {
            "parameters": {
                "content": (
                    "## Setup before activating\n"
                    "1. Import & activate **IT Ticketing - Error Notifier** first.\n"
                    "2. Create Outlook folders (mailbox root): **Inbox**, **Open Tickets**, **Processed**.\n"
                    "3. Open every **Move** node and reselect the correct folder "
                    "(folder IDs are tenant-specific).\n"
                    "4. Upload `IT Support Tickets.xlsx` (v2.0) to OneDrive/SharePoint; open every "
                    "**Excel** node and reselect workbook + Tickets/ITTickets + Audit Log/AuditLog.\n"
                    "5. Add **OpenRouter** (or swap to Groq) credential on **OpenRouter Chat Model**.\n"
                    "6. Workflow Settings → **Error Workflow** → Error Notifier.\n"
                    "7. Workflow Settings → **Concurrency** → `1` (no Excel lock sheet).\n"
                    "8. Confirm Outlook Trigger watches Inbox.\n"
                    "9. Update self-send filter email in Extract node if mailbox differs."
                ),
                "height": 380,
                "width": 440,
            },
            "id": "n24-note-setup",
            "name": "Sticky Note - Setup",
            "type": "n8n-nodes-base.stickyNote",
            "typeVersion": 1,
            "position": [0, 20],
        },
        {
            "parameters": {
                "content": (
                    "## Debug map (left → right)\n"
                    "1. Trigger → one email per execution\n"
                    "2. Extract → shouldProcess / priority / CCs\n"
                    "3. Drop → Processed (self/OOO)\n"
                    "4. Lookup ConversationID\n"
                    "   • exists + Ack=Yes → move Open Tickets\n"
                    "   • exists + Ack≠Yes → resume reply → update → move\n"
                    "5. New: Generate ID → uniqueness ≤5 → Data Guard\n"
                    "6. Invalid → Needs Review row → Open Tickets\n"
                    "7. Valid → AI summarize → Excel create (Ack=No) → Audit\n"
                    "   → Reply → Graph PATCH Ack → move → Graph PATCH Complete\n\n"
                    "Excel Table has no update op (n8n docs). Stage flags use "
                    "getRows + HTTP PATCH Graph range. Concurrency=1. See WORKFLOW_GUIDE.md."
                ),
                "height": 380,
                "width": 420,
            },
            "id": "n25-note-debug",
            "name": "Sticky Note - Debug Map",
            "type": "n8n-nodes-base.stickyNote",
            "typeVersion": 1,
            "position": [460, 20],
        },
    ]

    connections = {
        "Outlook Trigger - New Mail": {
            "main": [[{"node": "Extract, Filter & Prioritize", "type": "main", "index": 0}]]
        },
        "Extract, Filter & Prioritize": {
            "main": [[{"node": "IF - Should Process?", "type": "main", "index": 0}]]
        },
        "IF - Should Process?": {
            "main": [
                [{"node": "Excel - Lookup by ConversationID", "type": "main", "index": 0}],
                [{"node": "Move - Dropped to Processed", "type": "main", "index": 0}],
            ]
        },
        "Excel - Lookup by ConversationID": {
            "main": [[{"node": "Check If Ticket Exists", "type": "main", "index": 0}]]
        },
        "Check If Ticket Exists": {
            "main": [[{"node": "IF - Ticket Already Exists?", "type": "main", "index": 0}]]
        },
        "IF - Ticket Already Exists?": {
            "main": [
                [{"node": "IF - Ack Already Sent?", "type": "main", "index": 0}],
                [{"node": "Generate Ticket ID", "type": "main", "index": 0}],
            ]
        },
        "IF - Ack Already Sent?": {
            "main": [
                [{"node": "Move - Follow-up to Open Tickets", "type": "main", "index": 0}],
                [{"node": "Prepare Resume Reply", "type": "main", "index": 0}],
            ]
        },
        "Prepare Resume Reply": {
            "main": [[{"node": "Resume Reply to Requester", "type": "main", "index": 0}]]
        },
        "Resume Reply to Requester": {
            "main": [[{"node": "Excel - Get Rows (Resume Ack)", "type": "main", "index": 0}]]
        },
        "Excel - Get Rows (Resume Ack)": {
            "main": [[{"node": "Resolve Ack Patch (Resume)", "type": "main", "index": 0}]]
        },
        "Resolve Ack Patch (Resume)": {
            "main": [[{"node": "HTTP - Patch Ack Stage (Resume)", "type": "main", "index": 0}]]
        },
        "HTTP - Patch Ack Stage (Resume)": {
            "main": [[{"node": "HTTP - Patch Ack Timestamp (Resume)", "type": "main", "index": 0}]]
        },
        "HTTP - Patch Ack Timestamp (Resume)": {
            "main": [[{"node": "Move - Resume to Open Tickets", "type": "main", "index": 0}]]
        },
        "Move - Resume to Open Tickets": {
            "main": [[{"node": "Excel - Get Rows (Resume Complete)", "type": "main", "index": 0}]]
        },
        "Excel - Get Rows (Resume Complete)": {
            "main": [[{"node": "Resolve Complete Patch (Resume)", "type": "main", "index": 0}]]
        },
        "Resolve Complete Patch (Resume)": {
            "main": [[{"node": "HTTP - Patch Complete Folder (Resume)", "type": "main", "index": 0}]]
        },
        "HTTP - Patch Complete Folder (Resume)": {
            "main": [[{"node": "HTTP - Patch Complete Stage (Resume)", "type": "main", "index": 0}]]
        },
        "Generate Ticket ID": {
            "main": [[{"node": "Excel - Lookup TicketID", "type": "main", "index": 0}]]
        },
        "Excel - Lookup TicketID": {
            "main": [[{"node": "Check Ticket ID Collision", "type": "main", "index": 0}]]
        },
        "Check Ticket ID Collision": {
            "main": [[{"node": "IF - ID Collision Retry?", "type": "main", "index": 0}]]
        },
        "IF - ID Collision Retry?": {
            "main": [
                [{"node": "Generate Ticket ID", "type": "main", "index": 0}],
                [{"node": "Data Guard Validation", "type": "main", "index": 0}],
            ]
        },
        "Data Guard Validation": {
            "main": [[{"node": "IF - Valid Ticket Data?", "type": "main", "index": 0}]]
        },
        "IF - Valid Ticket Data?": {
            "main": [
                [{"node": "AI - Summarize Email", "type": "main", "index": 0}],
                [{"node": "Prepare Invalid Ticket Row", "type": "main", "index": 0}],
            ]
        },
        "Prepare Invalid Ticket Row": {
            "main": [[{"node": "Excel - Create Needs Review Row", "type": "main", "index": 0}]]
        },
        "Excel - Create Needs Review Row": {
            "main": [[{"node": "Move - Invalid to Open Tickets", "type": "main", "index": 0}]]
        },
        "AI - Summarize Email": {
            "main": [[{"node": "Merge AI Summary", "type": "main", "index": 0}]]
        },
        "OpenRouter Chat Model": {
            "ai_languageModel": [[{"node": "AI - Summarize Email", "type": "ai_languageModel", "index": 0}]]
        },
        "Structured Output Parser": {
            "ai_outputParser": [[{"node": "AI - Summarize Email", "type": "ai_outputParser", "index": 0}]]
        },
        "Merge AI Summary": {
            "main": [[{"node": "Excel - Create Ticket Row", "type": "main", "index": 0}]]
        },
        "Excel - Create Ticket Row": {
            "main": [[{"node": "Excel - Audit Log Created", "type": "main", "index": 0}]]
        },
        "Excel - Audit Log Created": {
            "main": [[{"node": "Prepare Reply Payload", "type": "main", "index": 0}]]
        },
        "Prepare Reply Payload": {
            "main": [[{"node": "Reply to Requester (HTML)", "type": "main", "index": 0}]]
        },
        "Reply to Requester (HTML)": {
            "main": [[{"node": "Excel - Get Rows (Ack)", "type": "main", "index": 0}]]
        },
        "Excel - Get Rows (Ack)": {
            "main": [[{"node": "Resolve Ack Patch", "type": "main", "index": 0}]]
        },
        "Resolve Ack Patch": {
            "main": [[{"node": "HTTP - Patch Ack Stage", "type": "main", "index": 0}]]
        },
        "HTTP - Patch Ack Stage": {
            "main": [[{"node": "HTTP - Patch Ack Timestamp", "type": "main", "index": 0}]]
        },
        "HTTP - Patch Ack Timestamp": {
            "main": [[{"node": "Move - Success to Open Tickets", "type": "main", "index": 0}]]
        },
        "Move - Success to Open Tickets": {
            "main": [[{"node": "Excel - Get Rows (Complete)", "type": "main", "index": 0}]]
        },
        "Excel - Get Rows (Complete)": {
            "main": [[{"node": "Resolve Complete Patch", "type": "main", "index": 0}]]
        },
        "Resolve Complete Patch": {
            "main": [[{"node": "HTTP - Patch Complete Folder", "type": "main", "index": 0}]]
        },
        "HTTP - Patch Complete Folder": {
            "main": [[{"node": "HTTP - Patch Complete Stage", "type": "main", "index": 0}]]
        },
    }

    return {
        "name": "IT Ticketing - Main",
        "nodes": nodes,
        "connections": connections,
        "pinData": {},
        "settings": {
            "executionOrder": "v1",
            "saveManualExecutions": True,
            "saveDataErrorExecution": "all",
            "saveDataSuccessExecution": "all",
            "callerPolicy": "workflowsFromSameOwner",
            "errorWorkflow": "",
        },
        "staticData": None,
        "meta": {
            "templateCredsSetupCompleted": False,
            "instanceId": "it-ticketing-main-v2",
        },
    }


def build_error() -> dict:
    format_code = r'''const execution = $json;

const workflowName = execution.workflow?.name || "Unknown workflow";
const failedNode = execution.execution?.lastNodeExecuted || "Unknown node";
const errorMessage = execution.execution?.error?.message || "No error message available";
const executionUrl = execution.execution?.url || "";
const timestamp = new Date().toLocaleString("en-GB", { timeZone: "Asia/Kolkata" });

const html = `
  <div style="font-family: 'Segoe UI', Helvetica, Arial, sans-serif; padding: 20px; color: #333;">
    <div style="max-width: 580px; margin: 0 auto; background: #fff; border: 1px solid #fca5a5; border-radius: 8px; overflow: hidden;">
      <div style="background-color: #dc2626; padding: 16px 25px; color: #fff;">
        <h2 style="margin:0; font-size:18px;">n8n Workflow Failure Alert</h2>
      </div>
      <div style="padding: 20px 25px;">
        <p><strong>Workflow:</strong> ${workflowName}</p>
        <p><strong>Failed Node:</strong> ${failedNode}</p>
        <p><strong>Error:</strong> ${errorMessage}</p>
        <p><strong>Time:</strong> ${timestamp}</p>
        ${executionUrl ? `<p><a href="${executionUrl}">View execution details</a></p>` : ""}
        <p style="font-size:13px; color:#64748b;">
          The IT Support Ticketing Main workflow failed. Check the failed execution.
          If a ticket row was written with Ack Sent=No, the next run for the same Conversation ID
          will resume the acknowledgement email (no duplicate ticket).
          Manually move the email out of Inbox only if it remains stuck after recovery.
        </p>
      </div>
    </div>
  </div>
`;

return [{
  json: {
    subject: `[ALERT] IT Ticketing Workflow Failed - ${workflowName}`,
    htmlBody: html
  }
}];
'''

    return {
        "name": "IT Ticketing - Error Notifier",
        "nodes": [
            {
                "parameters": {},
                "id": "e1-errortrigger",
                "name": "Error Trigger",
                "type": "n8n-nodes-base.errorTrigger",
                "typeVersion": 1,
                "position": [0, 300],
            },
            {
                "parameters": {"jsCode": format_code},
                "id": "e2-format",
                "name": "Format Error Details",
                "type": "n8n-nodes-base.code",
                "typeVersion": 2,
                "position": [260, 300],
            },
            {
                "parameters": {
                    "resource": "message",
                    "operation": "send",
                    "toRecipients": "it-admin@nextgeninnov8.com",
                    "subject": "={{ $json.subject }}",
                    "bodyContent": "={{ $json.htmlBody }}",
                    "bodyContentType": "html",
                    "options": {},
                },
                "id": "e3-send",
                "name": "Send Alert Email to IT Admin",
                "type": "n8n-nodes-base.microsoftOutlook",
                "typeVersion": 2,
                "position": [520, 300],
                "credentials": OUTLOOK_CRED,
            },
            {
                "parameters": {
                    "content": (
                        "## How to wire this up\n"
                        "1. Import & activate this workflow first.\n"
                        "2. Open **IT Ticketing - Main** → Settings → Error Workflow → select this workflow.\n"
                        "3. Update `toRecipients` in Send Alert Email to your real admin address.\n\n"
                        "n8n runs this automatically when any Main node throws an unhandled error."
                    ),
                    "height": 220,
                    "width": 400,
                },
                "id": "e4-note",
                "name": "Sticky Note - Setup",
                "type": "n8n-nodes-base.stickyNote",
                "typeVersion": 1,
                "position": [0, 40],
            },
        ],
        "connections": {
            "Error Trigger": {
                "main": [[{"node": "Format Error Details", "type": "main", "index": 0}]]
            },
            "Format Error Details": {
                "main": [[{"node": "Send Alert Email to IT Admin", "type": "main", "index": 0}]]
            },
        },
        "pinData": {},
        "settings": {"executionOrder": "v1"},
        "meta": {"instanceId": "it-ticketing-error-notifier-v1"},
    }


def main() -> None:
    main_wf = build_main()
    err_wf = build_error()
    WORKFLOWS_DIR.mkdir(parents=True, exist_ok=True)

    targets = [
        (WORKFLOWS_DIR / "IT_Ticketing_Main.json", main_wf),
        (WORKFLOWS_DIR / "IT_Ticketing_Error_Notifier.json", err_wf),
        # Also write beside the builder for local convenience
        (ROOT / "IT_Ticketing_Main.json", main_wf),
        (ROOT / "IT_Ticketing_Error_Notifier.json", err_wf),
    ]
    for path, payload in targets:
        path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        print(f"Wrote {path}")

    print(f"Main nodes: {len(main_wf['nodes'])}")
    print(f"Error nodes: {len(err_wf['nodes'])}")


if __name__ == "__main__":
    main()
