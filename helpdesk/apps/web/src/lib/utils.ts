import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { format, formatDistanceToNow } from 'date-fns'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '-'
  return format(new Date(value), 'dd MMM yyyy, HH:mm')
}

export function timeAgo(value: string | Date | null | undefined): string {
  if (!value) return '-'
  return formatDistanceToNow(new Date(value), { addSuffix: true })
}

export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
