import { z } from 'zod'
import { ROLES, TICKET_STATUSES, USER_STATUSES } from './constants.js'
import { passwordProblems } from './password.js'

export const passwordSchema = z.string().superRefine((pw, ctx) => {
  const problems = passwordProblems(pw)
  if (problems.length) ctx.addIssue({ code: 'custom', message: `Password needs: ${problems.join(', ')}` })
})

export const loginSchema = z.object({
  email: z.email().transform((e) => e.toLowerCase()),
  password: z.string().min(1),
})

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: passwordSchema,
})

export const createUserSchema = z.object({
  email: z.email().transform((e) => e.toLowerCase()),
  name: z.string().trim().min(1).max(120),
  role: z.enum(ROLES),
  department: z.string().trim().max(120).optional().nullable(),
  temporaryPassword: passwordSchema.optional(),
})

export const updateUserSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  role: z.enum(ROLES).optional(),
  status: z.enum(USER_STATUSES).optional(),
  department: z.string().trim().max(120).optional().nullable(),
})

export const resetPasswordSchema = z.object({
  temporaryPassword: passwordSchema.optional(),
})

export const domainSchema = z.object({
  domain: z.string().trim().min(3).max(253),
  includeSubdomains: z.boolean().default(false),
})

export const categorySchema = z.object({
  name: z.string().trim().min(1).max(80),
  sortOrder: z.number().int().default(0),
  active: z.boolean().default(true),
})

export const prioritySchema = z.object({
  name: z.string().trim().min(1).max(40),
  rank: z.number().int().default(0),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#64748b'),
  isDefault: z.boolean().default(false),
  active: z.boolean().default(true),
})

export const createTicketFieldsSchema = z.object({
  subject: z.string().trim().min(3).max(200),
  description: z.string().trim().min(5).max(10000),
  categoryId: z.uuid(),
  priorityId: z.uuid(),
})

export const updateTicketSchema = z.object({
  status: z.enum(TICKET_STATUSES).optional(),
  priorityId: z.uuid().optional(),
  categoryId: z.uuid().optional(),
  assigneeId: z.uuid().nullable().optional(),
  resolutionNotes: z.string().trim().max(5000).optional(),
})

export const ticketListQuerySchema = z.object({
  status: z.string().optional(),
  priorityId: z.uuid().optional(),
  assignee: z.string().optional(),
  q: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
})

export const messageFieldsSchema = z.object({
  body: z.string().trim().min(1).max(10000),
  kind: z.enum(['PUBLIC', 'INTERNAL_NOTE']).default('PUBLIC'),
})

export const reviewDecisionSchema = z.object({
  decision: z.enum(['accept', 'discard']),
  sendAck: z.boolean().default(false),
})
