import { createRootRouteWithContext, createRoute, createRouter, Outlet, redirect } from '@tanstack/react-router'
import type { QueryClient } from '@tanstack/react-query'
import { isStaff } from '@helpdesk/shared'
import { homePath, meQuery } from './lib/auth'
import { Layout } from './components/Layout'
import { LoginPage } from './pages/Login'
import { ChangePasswordPage } from './pages/ChangePassword'
import { MyTicketsPage } from './pages/MyTickets'
import { NewTicketPage } from './pages/NewTicket'
import { TicketDetailPage } from './pages/TicketDetail'
import { QueuePage } from './pages/Queue'
import { UsersPage } from './pages/admin/Users'
import { DomainsPage } from './pages/admin/Domains'
import { ListsPage } from './pages/admin/Lists'
import { SettingsPage } from './pages/admin/Settings'
import { MailboxPage } from './pages/admin/Mailbox'
import { AuditPage } from './pages/admin/Audit'

interface RouterContext {
  queryClient: QueryClient
}

const rootRoute = createRootRouteWithContext<RouterContext>()({ component: Outlet })

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  beforeLoad: async ({ context }) => {
    const me = await context.queryClient.ensureQueryData(meQuery)
    if (me) throw redirect({ to: me.mustChangePassword ? '/change-password' : homePath(me) })
  },
  component: LoginPage,
})

const changePasswordRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/change-password',
  beforeLoad: async ({ context }) => {
    const me = await context.queryClient.ensureQueryData(meQuery)
    if (!me) throw redirect({ to: '/login' })
  },
  component: ChangePasswordPage,
})

const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'app',
  beforeLoad: async ({ context }) => {
    const me = await context.queryClient.ensureQueryData(meQuery)
    if (!me) throw redirect({ to: '/login' })
    if (me.mustChangePassword) throw redirect({ to: '/change-password' })
    return { me }
  },
  component: Layout,
})

const indexRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/',
  beforeLoad: ({ context }) => {
    throw redirect({ to: homePath(context.me) })
  },
})

const myTicketsRoute = createRoute({ getParentRoute: () => appRoute, path: '/tickets', component: MyTicketsPage })
const newTicketRoute = createRoute({ getParentRoute: () => appRoute, path: '/tickets/new', component: NewTicketPage })
const ticketRoute = createRoute({ getParentRoute: () => appRoute, path: '/tickets/$ticketId', component: TicketDetailPage })

const staffRoute = createRoute({
  getParentRoute: () => appRoute,
  id: 'staff',
  beforeLoad: ({ context }) => {
    if (!isStaff(context.me.role)) throw redirect({ to: '/tickets' })
  },
})
const queueRoute = createRoute({ getParentRoute: () => staffRoute, path: '/queue', component: () => <QueuePage /> })
const reviewRoute = createRoute({ getParentRoute: () => staffRoute, path: '/review', component: () => <QueuePage reviewOnly /> })

const adminRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/admin',
  beforeLoad: ({ context }) => {
    if (context.me.role !== 'ADMIN') throw redirect({ to: homePath(context.me) })
  },
})
const usersRoute = createRoute({ getParentRoute: () => adminRoute, path: '/users', component: UsersPage })
const domainsRoute = createRoute({ getParentRoute: () => adminRoute, path: '/domains', component: DomainsPage })
const listsRoute = createRoute({ getParentRoute: () => adminRoute, path: '/lists', component: ListsPage })
const settingsRoute = createRoute({ getParentRoute: () => adminRoute, path: '/settings', component: SettingsPage })
const mailboxRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: '/mailbox',
  validateSearch: (s: Record<string, unknown>): { connected?: string; error?: string } => ({
    connected: typeof s.connected === 'string' || typeof s.connected === 'number' ? String(s.connected) : undefined,
    error: typeof s.error === 'string' ? s.error : undefined,
  }),
  component: MailboxPage,
})
const auditRoute = createRoute({ getParentRoute: () => adminRoute, path: '/audit', component: AuditPage })

const routeTree = rootRoute.addChildren([
  loginRoute,
  changePasswordRoute,
  appRoute.addChildren([
    indexRoute,
    myTicketsRoute,
    newTicketRoute,
    ticketRoute,
    staffRoute.addChildren([queueRoute, reviewRoute]),
    adminRoute.addChildren([usersRoute, domainsRoute, listsRoute, settingsRoute, mailboxRoute, auditRoute]),
  ]),
])

export function createAppRouter(queryClient: QueryClient) {
  return createRouter({ routeTree, context: { queryClient }, defaultPreload: 'intent' })
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>
  }
}
