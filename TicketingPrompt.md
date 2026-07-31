# MASTER PROMPT — Production-Grade n8n IT Helpdesk Ticketing System

You are an expert Enterprise Automation Architect, Senior n8n Developer, Microsoft 365 Integration Specialist, Solution Architect, and Production System Designer.

I want you to design a **production-grade IT Helpdesk Ticketing System** using **n8n**, **Microsoft Outlook**, and **Microsoft Excel** (stored on OneDrive/SharePoint).

This is **NOT** a proof of concept or demo workflow. It will be deployed as a **production system** within a company and must therefore be designed with **enterprise-grade reliability, maintainability, scalability, security, and fault tolerance**.

Think and design this solution like a senior software architect responsible for a mission-critical internal application.

---

# Project Objective

Whenever an employee sends an email to the IT Support mailbox:

- Automatically create a new support ticket.
- Generate a unique ticket ID.
- Store all ticket details in Excel.
- Send an acknowledgement email containing the ticket ID.
- Preserve the email conversation for future follow-ups.
- Prevent duplicate ticket creation.
- Ensure complete data integrity with zero data loss.

The entire solution should be suitable for long-term production use.

---

# 1. Trigger Requirements

The workflow must begin **ONLY** with the **Microsoft Outlook Trigger** node.

**Do NOT use:**

- Schedule Trigger
- Cron
- Polling
- Manual Trigger

The Outlook Trigger should immediately react whenever a new email arrives.

---

# 2. Concurrency & Production Reliability (Highest Priority)

Assume the following production scenarios:

- 10 emails arrive at exactly the same second.
- 50 or more emails arrive within one minute.
- Multiple employees send emails with similar subjects simultaneously.

The workflow must guarantee:

- Zero data loss
- Zero duplicate tickets
- Zero ticket collisions
- Zero race conditions
- Zero data overwriting
- Zero mixing of email data between executions

For example:

- Email A must never receive Email B's ticket ID.
- Email B's details must never be stored in Email A's row.
- Every execution must remain fully isolated.

Design the workflow to be completely safe under concurrent execution.

Explain how n8n handles parallel executions and describe any additional safeguards required.

---

# 3. Fresh Email Detection

Only brand-new support requests should create tickets.

Emails that already belong to an existing ticket must **never** generate another ticket.

Use the most reliable enterprise approach to distinguish new requests from follow-ups.

Consider methods such as:

- Outlook Conversation ID
- Internet Message ID
- Conversation Index
- Thread ID
- Subject analysis
- Ticket ID detection
- Folder-based segregation

Recommend the best production approach and explain why.

---

# 4. Outlook Folder Strategy

Use Outlook folders to simplify processing and reduce unnecessary workflow executions.

After a ticket is successfully created:

- Move the email conversation to an appropriate folder.
- Prevent the same conversation from being processed again as a new ticket.

Recommend a production-ready folder structure.

Example:

```text
Inbox
 └── New Requests

Processed
 ├── Open Tickets
 ├── Pending
 └── Closed

Archive
 └── Archived Tickets
```

Explain why your chosen folder strategy is reliable.

---

# 5. Ticket ID Generation

The ticket ID must follow this format:

```text
NGI-<ddmmyy>-<XXXX>
```

Where:

- **NGI** = Company prefix
- **ddmmyy** = Ticket creation date
- **XXXX** = Random 4-character uppercase alphanumeric string (A–Z, 0–9)

Examples:

```text
NGI-310726-A7K9
NGI-310726-4PXM
NGI-310726-X2Q8
NGI-310726-B91F
```

Requirements:

- Human-readable
- Short
- Easy to communicate over phone or email
- Easy to search
- Unique for every ticket

Before assigning a ticket ID:

- Verify it does not already exist in the ticket repository.
- If a collision occurs, generate another random suffix until a unique ID is found.

Explain how the uniqueness check is implemented safely for concurrent workflow executions.

---

# 6. Auto Acknowledgement Email

After ticket creation:

Reply to the original email thread.

The acknowledgement email should include:

- Ticket ID
- Confirmation that the request has been received
- Date & time of ticket creation
- Expected response information
- Optional contact details
- Professional formatting

The acknowledgement must remain part of the original Outlook conversation.

---

# 7. CC Handling

If the original email contains CC recipients:

- Preserve all CC recipients.
- Include everyone in the acknowledgement email.
- Maintain the original conversation thread.

No recipient should be omitted.

---

# 8. Ticket Storage

Store every ticket in Excel with complete traceability.

At minimum include:

- Ticket ID
- Created Date
- Created Time
- Requester Name
- Requester Email
- CC Emails
- Subject
- Email Body
- Priority
- Category
- Department
- Status
- Assigned Engineer
- Conversation ID
- Internet Message ID
- Conversation Index
- Folder
- Last Updated
- Closed Date
- Resolution Notes
- Internal Remarks

Recommend any additional metadata useful for production support.

---

# 9. Follow-Up Emails

When users reply to an existing ticket:

- Do **NOT** create another ticket.
- Detect the existing conversation.
- Keep the same ticket ID.
- Update the ticket if necessary.
- Preserve the complete email thread.

The workflow should reliably distinguish:

- New Ticket
- Existing Ticket

using the best enterprise approach.

---

# 10. Error Handling

Production systems must never fail silently.

Design comprehensive error handling including:

- Error Trigger workflow
- Logging
- Retry strategy
- Administrator notifications
- Failure reporting
- Partial failure recovery
- Graceful handling of temporary Outlook or Excel failures

---

# 11. Duplicate Prevention

Prevent duplicate ticket creation caused by:

- Outlook retries
- Workflow restart
- Network interruptions
- Execution timeout
- Multiple trigger events
- Race conditions

Recommend a production-grade idempotency strategy.

---

# 12. Data Integrity

Guarantee that:

- One email creates only one ticket.
- One ticket corresponds to exactly one requester.
- Ticket IDs are never duplicated.
- Replies never overwrite unrelated tickets.
- Concurrent executions never interfere with one another.
- No data corruption occurs.

---

# 13. Excel Workbook Design

Design a professional Excel workbook suitable for long-term operational use.

Recommend workbook structure including sheets such as:

- Tickets
- Dashboard
- Configuration
- Categories
- Users
- Audit Log
- Reports

Explain the purpose of each sheet.

---

# 14. Excel Data Validation

Create professional dropdowns for:

- Ticket Status
- Priority
- Category
- Department
- Assigned Engineer
- Escalation Level
- Resolution
- Closure Reason

Use named ranges wherever appropriate.

---

# 15. Excel Conditional Formatting

Recommend formatting such as:

- Open tickets → Red
- In Progress → Orange
- Pending → Yellow
- Closed → Green
- High Priority → Highlighted
- Overdue tickets → Warning color
- SLA breached → Critical highlight
- Missing assignment → Alert
- Duplicate detection → Highlight

The workbook should be visually clean and easy for IT administrators to use.

---

# 16. Excel Automation

Recommend formulas and automation for:

- Ticket Age
- Days Open
- SLA Remaining
- Resolution Time
- Monthly Statistics
- Open Ticket Count
- Closed Ticket Count
- Engineer Workload
- Category Statistics
- Department Statistics
- Trend Charts

---

# 17. Excel Deliverable

Provide either:

## Option A

A downloadable production-ready Excel workbook.

**OR**

## Option B

A complete Python script using **openpyxl** that automatically generates the workbook with:

- Professional formatting
- Tables
- Filters
- Freeze panes
- Named ranges
- Dropdowns
- Data validation
- Conditional formatting
- Dashboard
- Charts (if appropriate)
- Sample data
- Workbook protection where appropriate

The workbook should require minimal or no manual formatting.

---

# 18. n8n Workflow Deliverables

Provide:

- Complete workflow architecture
- Node-by-node explanation
- Every node configuration
- All required expressions
- Production best practices
- Error handling implementation
- Security recommendations
- Scalability considerations
- Future enhancement recommendations

The explanation should be detailed enough for direct implementation without making architectural assumptions.

---

# 19. Best Practices

Use only production-ready design patterns.

Avoid:

- Fragile expressions
- Unnecessary nodes
- Race conditions
- Duplicate processing
- Poor error handling

Use:

- Environment variables where appropriate
- Modular workflow design
- Reusable logic
- Clear documentation
- Reliable execution flow
- Maintainable architecture

---

# 20. Architecture Review Checklist

Before finalizing the solution, verify that every requirement has been satisfied.

The final design must include:

- Outlook Trigger only (no Schedule or Cron)
- Safe concurrent processing
- Zero data loss
- Zero race conditions
- Unique ticket IDs
- Human-readable ticket IDs
- Proper new vs. existing email detection
- Conversation preservation
- CC preservation
- Folder-based processing strategy
- Professional Excel workbook
- Production-grade error handling
- Duplicate prevention
- Data integrity
- Scalability
- Security
- Maintainability
- Node-by-node implementation guide
- Complete workflow documentation

---

# Final Requirement

The final solution should be architected to **production standards** and be suitable for **immediate deployment in an enterprise environment**.