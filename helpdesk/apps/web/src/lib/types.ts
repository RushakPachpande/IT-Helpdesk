import type { Role, TicketStatus, UserStatus } from '@helpdesk/shared'

export interface Me {
  id: string
  email: string
  name: string
  role: Role
  status: UserStatus
  mustChangePassword: boolean
  department: string | null
}

export interface Category {
  id: string
  name: string
  sortOrder: number
  active: boolean
}

export interface Priority {
  id: string
  name: string
  rank: number
  color: string
  isDefault: boolean
  active: boolean
}

export interface Meta {
  categories: Category[]
  priorities: Priority[]
  attachments: { maxFileMb: number; maxFilesPerMessage: number; allowedMimeTypes: string[] }
}

export interface TicketSummary {
  id: string
  ticketNumber: string
  subject: string
  description: string
  status: TicketStatus
  source: 'WEB' | 'EMAIL'
  requesterEmail: string
  requesterName: string
  ccEmails: string[]
  needsReviewReason: string | null
  aiSummary: string | null
  aiPriority: string | null
  resolutionNotes: string | null
  resolvedAt: string | null
  closedAt: string | null
  lastActivityAt: string
  createdAt: string
  category: { id: string; name: string } | null
  priority: { id: string; name: string; color: string; rank: number } | null
  assignee: { id: string; name: string; email: string } | null
  requester: { id: string; name: string; email: string; status: UserStatus } | null
}

export interface TicketMessage {
  id: string
  kind: 'PUBLIC' | 'INTERNAL_NOTE' | 'SYSTEM'
  source: 'WEB' | 'EMAIL'
  bodyText: string
  authorId: string | null
  authorName: string | null
  authorEmail: string | null
  createdAt: string
  author: { id: string; name: string; role: Role } | null
}

export interface AttachmentInfo {
  id: string
  messageId: string | null
  fileName: string
  mimeType: string
  sizeBytes: number
  inline: boolean
  createdAt: string
}

export interface OutboundInfo {
  id: string
  kind: string
  status: 'QUEUED' | 'SENT' | 'FAILED' | 'SUPPRESSED'
  toEmails: string[]
  lastError: string | null
  sentAt: string | null
  createdAt: string
  messageId: string | null
}

export interface TicketDetail {
  ticket: TicketSummary
  messages: TicketMessage[]
  attachments: AttachmentInfo[]
  outbound: OutboundInfo[]
  canReopen: boolean
}

export interface AdminUser {
  id: string
  email: string
  name: string
  role: Role
  status: UserStatus
  department: string | null
  mustChangePassword: boolean
  lastLoginAt: string | null
  lockedUntil: string | null
  createdAt: string
}

export interface Agent {
  id: string
  name: string
  email: string
  role: Role
}
