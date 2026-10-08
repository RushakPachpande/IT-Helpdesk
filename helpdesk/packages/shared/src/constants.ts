export const ROLES = ['EMPLOYEE', 'AGENT', 'ADMIN'] as const
export type Role = (typeof ROLES)[number]

export const USER_STATUSES = ['ACTIVE', 'INACTIVE', 'PLACEHOLDER'] as const
export type UserStatus = (typeof USER_STATUSES)[number]

export const TICKET_STATUSES = [
  'NEEDS_REVIEW',
  'NEW',
  'OPEN',
  'IN_PROGRESS',
  'WAITING_ON_REQUESTER',
  'RESOLVED',
  'CLOSED',
] as const
export type TicketStatus = (typeof TICKET_STATUSES)[number]

export const TICKET_STATUS_LABELS: Record<TicketStatus, string> = {
  NEEDS_REVIEW: 'Needs Review',
  NEW: 'New',
  OPEN: 'Open',
  IN_PROGRESS: 'In Progress',
  WAITING_ON_REQUESTER: 'Waiting on Requester',
  RESOLVED: 'Resolved',
  CLOSED: 'Closed',
}

/** Statuses that count as "active work" for queues. */
export const ACTIVE_STATUSES: TicketStatus[] = ['NEW', 'OPEN', 'IN_PROGRESS', 'WAITING_ON_REQUESTER']

export const MESSAGE_KINDS = ['PUBLIC', 'INTERNAL_NOTE', 'SYSTEM'] as const
export type MessageKind = (typeof MESSAGE_KINDS)[number]

export const MAIL_PROVIDERS = ['MICROSOFT', 'GOOGLE', 'IMAP'] as const
export type MailProvider = (typeof MAIL_PROVIDERS)[number]

export const ROLE_LABELS: Record<Role, string> = {
  EMPLOYEE: 'Employee',
  AGENT: 'IT Agent',
  ADMIN: 'Admin',
}

export function isStaff(role: Role | undefined | null): boolean {
  return role === 'AGENT' || role === 'ADMIN'
}

/** Realtime event names shared by API and web. */
export const EVENTS = {
  ticketChanged: 'ticket:changed',
  ticketMessage: 'ticket:message',
  queueChanged: 'queue:changed',
  mailboxChanged: 'mailbox:changed',
} as const
