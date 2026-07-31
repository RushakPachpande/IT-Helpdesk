# Workflow Improvement Instructions

During the workflow test runs, the following issues were identified. These should be addressed in the next iteration of the workflow.

---

## 1. Workflow Failure Recovery (Highest Priority)

### Current Issue
If the workflow fails at any point during execution, the ticket processing is permanently interrupted.

Examples:
- If the workflow fails before creating the ticket, the email is never processed again.
- If the workflow successfully generates a Ticket ID but fails while sending the acknowledgment email, the Excel row already exists. On the next execution, the workflow assumes the request has already been completed and skips it.

This creates inconsistencies where:
- The IT team believes the ticket was successfully raised.
- The requester never receives the Ticket ID.
- The request is effectively lost.

### Expected Solution
The workflow must become **fault tolerant**.

Requirements:
- No email should ever be permanently lost because of a workflow failure.
- Every processing stage should be recoverable.
- If execution fails, the workflow should be able to resume from the last completed stage rather than starting over or ignoring the request.
- Ticket creation and email notification should be treated as separate completion states.

---

## 2. Review the Locking Mechanism

### Current Observation

The workflow currently marks records as **Locked**, but there is no clear mechanism that changes them back to **Unlocked**.

This raises several concerns:

- What is the purpose of the lock?
- Is it actually preventing concurrent execution?
- Why are locks never released?
- Over time, the Excel sheet accumulates unnecessary lock states.

### Recommendation

Evaluate whether a locking mechanism is actually required.

If locking is necessary:
- Acquire the lock only while processing.
- Release the lock immediately after successful completion or failure.

If locking is unnecessary:
- Remove the lock logic entirely to simplify the workflow.

---

## 3. Simplify Folder Structure

The current folder structure is more complex than necessary.

### Recommended Folder Structure

```
Inbox
Processed
Open Tickets
```

### Folder Logic

**Inbox**
- All newly received emails arrive here.

**Open Tickets**
- Move emails here immediately after a ticket has been successfully created.
- These represent active tickets awaiting resolution.

**Processed**
- Move emails here only after the ticket has been resolved and closed.

This approach keeps the workflow simple, predictable, and easier to maintain.

---

## 4. AI-Based Email Summarization

To improve readability for IT Engineers and Administrators, introduce a lightweight AI summarization step.

### Purpose

Many non-technical users struggle to explain technical issues accurately. As a result:
- Emails are often unnecessarily long.
- Problems are exaggerated.
- Important details are buried in the text.

An AI summarization node should extract the essential information into a concise and structured format.

The generated summary should be stored alongside the ticket in the Excel sheet for future reference.

### AI Prompt

```text
You are an IT Support Assistant.

Analyze the following email subject and body.

Generate a concise summary (2–3 sentences) for an IT Engineer or IT Administrator.

Output must follow this exact format:

- Issue: [Brief summary of the actual problem]
- Urgency/Priority: [Low / Medium / High / Critical]
- Scope: [Affected user, application, device, or system]

Guidelines:
- Focus only on the actual technical issue.
- Ignore greetings, signatures, and unnecessary details.
- Default the priority to "Medium" unless the email clearly indicates otherwise.
- Keep the output concise, factual, and easy to understand.

Email Content

Subject:
{{ $json.subject }}

Body:
{{ $json.body }}
```

### Data Storage

The following fields should be stored in the corresponding Excel row:

- AI Issue Summary
- AI Priority
- AI Scope

This allows IT personnel to quickly understand the request without reading the entire email.
