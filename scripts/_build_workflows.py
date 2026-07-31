#!/usr/bin/env python3
"""Build IT_Ticketing_Main.json and IT_Ticketing_Error_Notifier.json."""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent

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

WORKBOOK = {
    "__rl": True,
    "value": "01RDI7SP6BFKEGCJAM2BD22TEHTPLGKW4K",
    "mode": "list",
    "cachedResultName": "IT Support Tickets",
    "cachedResultUrl": (
        "https://asmeduorg-my.sharepoint.com/personal/itsupport_nextgeninnov8_com/"
        "_layouts/15/Doc.aspx?sourcedoc=%7B61882AC1-0C24-47D0-AD4C-879BD6655B8A%7D"
        "&file=IT%20Support%20Tickets.xlsx&action=default&mobileredirect=true&DefaultItemOpen=1"
    ),
}
WS_TICKETS = {
    "__rl": True,
    "value": "{00000000-0001-0000-0000-000000000000}",
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

# Tenant-specific folder IDs from existing v2.0 where known; reselect after creating new folders
FOLDER_PROCESSED = {
    "__rl": True,
    "value": "AQMkADg1YzU0ZDliLTUxNWItNDA0Yi1iMWMzLTFmN2YyZTIzNDZjYwAALgAAA8BXGtiWaUtMrakyzw4cBCcBACiz4DB5C1xLi-DdZ9AT76kAAAJhqgAAAA==",
    "mode": "list",
    "cachedResultName": "Processed",
}
FOLDER_NEEDS_REVIEW = {
    "__rl": True,
    "value": "AQMkADg1YzU0ZDliLTUxNWItNDA0Yi1iMWMzLTFmN2YyZTIzNDZjYwAALgAAA8BXGtiWaUtMrakyzw4cBCcBACiz4DB5C1xLi-DdZ9AT76kAAAJhqAAAAA==",
    "mode": "list",
    "cachedResultName": "NeedsReview",
}
FOLDER_FILTERED = {
    "__rl": True,
    "value": "",
    "mode": "list",
    "cachedResultName": "Filtered  <-- RESELECT AFTER CREATING FOLDER",
}
FOLDER_OPEN_TICKETS = {
    "__rl": True,
    "value": "",
    "mode": "list",
    "cachedResultName": "Processed/Open Tickets  <-- RESELECT AFTER CREATING FOLDER",
}


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
    folderLabel: "Processed/Open Tickets"
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

return [{
  json: {
    ...currentEmail,
    ticketExists,
    existingTicketId: ticketId
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


def prepare_reply_code() -> str:
    return r'''// After Excel append nodes, $json is the Excel API response — not our ticket.
// pairedItem is often undefined across Excel nodes, so NEVER use $('Node').item here.
// .first() reads that node's output for this execution without pairing.
const ticket = $('Data Guard Validation').first().json;

const messageId = String(ticket.messageId || "").trim();
if (!messageId) {
  throw new Error(`Missing valid Outlook messageId for reply. Received: ${JSON.stringify(ticket.messageId)}`);
}

return [{
  json: {
    messageId,
    conversationId: ticket.conversationId,
    internetMessageId: ticket.internetMessageId,
    ticketId: ticket.ticketId,
    senderName: ticket.senderName || "Valued User",
    senderEmail: ticket.senderEmail || "",
    ccEmails: ticket.ccEmails || "",
    subject: ticket.subject || "(no subject)",
    priority: ticket.priority || "Medium",
    createdDate: ticket.createdDate,
    createdTime: ticket.createdTime
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
            "n04-move-filtered",
            "Move - Dropped to Filtered",
            "={{ $json.messageId }}",
            FOLDER_FILTERED,
            [780, 600],
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
        move_node(
            "n08-move-followup",
            "Move - Follow-up to Open Tickets",
            "={{ $json.messageId }}",
            FOLDER_OPEN_TICKETS,
            [1560, 120],
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
        move_node(
            "n15-move-invalid",
            "Move - Invalid to NeedsReview",
            "={{ $json.messageId }}",
            FOLDER_NEEDS_REVIEW,
            [3120, 700],
        ),
        {
            "parameters": {
                "resource": "table",
                "operation": "append",
                "workbook": WORKBOOK,
                "worksheet": WS_TICKETS,
                "table": TBL_TICKETS,
                "fieldsUi": {
                    "values": [
                        {"column": "Ticket ID", "fieldValue": "={{ $json.ticketId }}"},
                        {"column": "Created Date", "fieldValue": "={{ $json.createdDate }}"},
                        {"column": "Created Time", "fieldValue": "={{ $json.createdTime }}"},
                        {"column": "Requester Name", "fieldValue": "={{ $json.senderName }}"},
                        {"column": "Requester Email", "fieldValue": "={{ $json.senderEmail }}"},
                        {"column": "CC Emails", "fieldValue": "={{ $json.ccEmails }}"},
                        {"column": "Subject", "fieldValue": "={{ $json.subject }}"},
                        {"column": "Email Body", "fieldValue": "={{ $json.bodyPreview }}"},
                        {"column": "Priority", "fieldValue": "={{ $json.priority }}"},
                        {"column": "Category", "fieldValue": "Other"},
                        {"column": "Department", "fieldValue": "Other"},
                        {"column": "Status", "fieldValue": "New"},
                        {"column": "Assigned Engineer", "fieldValue": "Unassigned"},
                        {"column": "Conversation ID", "fieldValue": "={{ $json.conversationId }}"},
                        {"column": "Internet Message ID", "fieldValue": "={{ $json.internetMessageId }}"},
                        {"column": "Conversation Index", "fieldValue": "={{ $json.conversationIndex }}"},
                        {"column": "Message Id", "fieldValue": "={{ $json.messageId }}"},
                        {"column": "Folder", "fieldValue": "Processed/Open Tickets"},
                        {"column": "Last Updated", "fieldValue": "={{ $json.lastUpdated }}"},
                        {"column": "Closed Date", "fieldValue": ""},
                        {"column": "Resolution Notes", "fieldValue": ""},
                        {"column": "Internal Remarks", "fieldValue": ""},
                        {"column": "Escalation Level", "fieldValue": "L1"},
                        {"column": "Resolution", "fieldValue": ""},
                        {"column": "Closure Reason", "fieldValue": ""},
                    ]
                },
                "options": {},
            },
            "id": "n16-create",
            "name": "Excel - Create Ticket Row",
            "type": "n8n-nodes-base.microsoftExcel",
            "typeVersion": 2.2,
            "position": [3120, 400],
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
                            "fieldValue": "={{ $('Data Guard Validation').first().json.ticketId }}",
                        },
                        {
                            "column": "Conversation ID",
                            "fieldValue": "={{ $('Data Guard Validation').first().json.conversationId }}",
                        },
                        {
                            "column": "Message Id",
                            "fieldValue": "={{ $('Data Guard Validation').first().json.messageId }}",
                        },
                        {
                            "column": "Detail",
                            "fieldValue": "={{ $('Data Guard Validation').first().json.subject }}",
                        },
                    ]
                },
                "options": {},
            },
            "id": "n17-audit",
            "name": "Excel - Audit Log Created",
            "type": "n8n-nodes-base.microsoftExcel",
            "typeVersion": 2.2,
            "position": [3380, 400],
            "credentials": EXCEL_CRED,
            "continueOnFail": True,
            "retryOnFail": True,
            "maxTries": 2,
            "waitBetweenTries": 1500,
        },
        {
            "parameters": {"jsCode": prepare_reply_code()},
            "id": "n18-prep-reply",
            "name": "Prepare Reply Payload",
            "type": "n8n-nodes-base.code",
            "typeVersion": 2,
            "position": [3640, 400],
        },
        {
            "parameters": {
                # Outlook v2 has no "replyAll" operation — that crashes the router
                # (Cannot read properties of undefined reading 'execute').
                # Use reply + replyToSenderOnly=false → Graph createReplyAll (keeps CCs).
                "resource": "message",
                "operation": "reply",
                "replyToSenderOnly": False,
                "messageId": {
                    "__rl": True,
                    "value": "={{ $json.messageId }}",
                    "mode": "id",
                },
                "message": REPLY_HTML,
                "options": {},
            },
            "id": "n19-reply",
            "name": "Reply to Requester (HTML)",
            "type": "n8n-nodes-base.microsoftOutlook",
            "typeVersion": 2,
            "position": [3900, 400],
            "credentials": OUTLOOK_CRED,
            "retryOnFail": True,
            "maxTries": 2,
            "waitBetweenTries": 3000,
        },
        move_node(
            "n20-move-success",
            "Move - Success to Open Tickets",
            "={{ $('Prepare Reply Payload').first().json.messageId }}",
            FOLDER_OPEN_TICKETS,
            [4160, 400],
        ),
        {
            "parameters": {
                "content": (
                    "## Setup before activating\n"
                    "1. Import & activate **IT Ticketing - Error Notifier** first.\n"
                    "2. Create Outlook folders: Filtered, NeedsReview, Processed/Open Tickets "
                    "(+ Pending, Closed, Archive as needed).\n"
                    "3. Open every **Move** node and reselect the correct folder "
                    "(folder IDs are tenant-specific).\n"
                    "4. Upload `IT Support Tickets.xlsx` to OneDrive/SharePoint; open every "
                    "**Excel** node and reselect workbook + Tickets/ITTickets + Audit Log/AuditLog.\n"
                    "5. Workflow Settings → **Error Workflow** → Error Notifier.\n"
                    "6. Workflow Settings → **Concurrency** → `1`.\n"
                    "7. Confirm Outlook Trigger watches Inbox and credentials are connected.\n"
                    "8. Update self-send filter email in Extract node if mailbox differs."
                ),
                "height": 340,
                "width": 420,
            },
            "id": "n21-note-setup",
            "name": "Sticky Note - Setup",
            "type": "n8n-nodes-base.stickyNote",
            "typeVersion": 1,
            "position": [0, 40],
        },
        {
            "parameters": {
                "content": (
                    "## Debug map (left → right)\n"
                    "1. Trigger → one email per execution\n"
                    "2. Extract → sets shouldProcess / priority / CCs\n"
                    "3. Drop → Filtered (self/OOO)\n"
                    "4. Lookup ConversationID → follow-up? move & stop\n"
                    "5. Generate NGI-ddmmyy-XXXX → uniqueness check (retry ≤5)\n"
                    "6. Data Guard → NeedsReview if invalid\n"
                    "7. Excel create → AuditLog → Reply (Reply All) → move Open Tickets\n\n"
                    "Partial failure: Excel first. Retry is safe via ConversationID dedupe.\n"
                    "No Schedule/Cron. See WORKFLOW_GUIDE.md."
                ),
                "height": 320,
                "width": 400,
            },
            "id": "n22-note-debug",
            "name": "Sticky Note - Debug Map",
            "type": "n8n-nodes-base.stickyNote",
            "typeVersion": 1,
            "position": [440, 40],
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
                [{"node": "Move - Dropped to Filtered", "type": "main", "index": 0}],
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
                [{"node": "Move - Follow-up to Open Tickets", "type": "main", "index": 0}],
                [{"node": "Generate Ticket ID", "type": "main", "index": 0}],
            ]
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
                [{"node": "Excel - Create Ticket Row", "type": "main", "index": 0}],
                [{"node": "Move - Invalid to NeedsReview", "type": "main", "index": 0}],
            ]
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
            "main": [[{"node": "Move - Success to Open Tickets", "type": "main", "index": 0}]]
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
            "instanceId": "it-ticketing-main-v1",
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
          If a ticket row was already written, ConversationID dedupe will prevent a duplicate
          on retry. Manually move the email out of Inbox if it is stuck after a partial failure.
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
    (ROOT / "IT_Ticketing_Main.json").write_text(
        json.dumps(main_wf, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    (ROOT / "IT_Ticketing_Error_Notifier.json").write_text(
        json.dumps(err_wf, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    print("Wrote IT_Ticketing_Main.json")
    print("Wrote IT_Ticketing_Error_Notifier.json")
    print(f"Main nodes: {len(main_wf['nodes'])}")
    print(f"Error nodes: {len(err_wf['nodes'])}")


if __name__ == "__main__":
    main()
