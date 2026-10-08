import { expect, test, type Browser, type Page } from '@playwright/test'

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? 'admin@example.com'
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'ChangeMe!12345'
const DOMAIN = process.env.E2E_DOMAIN ?? 'example.com'
const NEW_PASSWORD = 'E2eStrongPass1'

// 1x1 PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')

async function login(browser: Browser, email: string, password: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage()
  page.on('console', (m) => m.type() === 'error' && !m.text().includes('401') && console.log(`[${email}] ${m.text().slice(0, 1500)}`))
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  return page
}

async function createUser(admin: Page, email: string, name: string, role: 'Employee' | 'IT Agent'): Promise<string> {
  await admin.goto('/admin/users')
  await admin.getByRole('button', { name: 'Create user' }).click()
  const dialog = admin.getByRole('dialog', { name: 'Create user' })
  await dialog.getByLabel('Company email').fill(email)
  await dialog.getByLabel('Full name').fill(name)
  await dialog.getByLabel('Role').selectOption({ label: role })
  await dialog.getByRole('button', { name: 'Create user' }).click()
  const pwDialog = admin.getByRole('dialog', { name: 'Temporary password' })
  const password = (await pwDialog.locator('code').textContent())?.trim()
  expect(password).toBeTruthy()
  await pwDialog.getByRole('button', { name: 'Done' }).click()
  return password!
}

async function firstLogin(browser: Browser, email: string, tempPassword: string): Promise<Page> {
  const page = await login(browser, email, tempPassword)
  await expect(page.getByRole('heading', { name: 'Set your password' })).toBeVisible()
  await page.getByLabel('Temporary password').fill(tempPassword)
  await page.getByLabel('New password', { exact: true }).fill(NEW_PASSWORD)
  await page.getByLabel('Confirm new password').fill(NEW_PASSWORD)
  await page.getByRole('button', { name: 'Save password' }).click()
  await expect(page).not.toHaveURL(/change-password/)
  return page
}

test('employee raises a ticket, agent replies live, ticket is resolved and confirmed', async ({ browser }) => {
  const stamp = Date.now()
  const employeeEmail = `e2e-employee-${stamp}@${DOMAIN}`
  const agentEmail = `e2e-agent-${stamp}@${DOMAIN}`
  const subject = `E2E printer jam ${stamp}`

  const admin = await login(browser, ADMIN_EMAIL, ADMIN_PASSWORD)
  await expect(admin).toHaveURL(/\/queue/)
  const employeeTemp = await createUser(admin, employeeEmail, 'E2E Employee', 'Employee')
  const agentTemp = await createUser(admin, agentEmail, 'E2E Agent', 'IT Agent')

  // Employee: first sign-in, raise a request with a screenshot.
  const employee = await firstLogin(browser, employeeEmail, employeeTemp)
  await expect(employee).toHaveURL(/\/tickets$/)
  await employee.goto('/tickets/new')
  await employee.getByLabel('Subject').fill(subject)
  await employee.getByLabel('Type of issue').selectOption({ label: 'Printer' })
  await employee.getByLabel('Description').fill('The 2nd floor printer shows a paper jam after every page.')
  await employee.locator('input[type=file]').setInputFiles({ name: 'jam.png', mimeType: 'image/png', buffer: PNG })
  await employee.getByRole('button', { name: 'Submit request' }).click()
  await expect(employee.getByRole('heading', { name: subject })).toBeVisible()
  await expect(employee.getByRole('img', { name: 'jam.png' })).toBeVisible()
  const ticketUrl = employee.url()

  // Agent: first sign-in, find the ticket in the queue and reply.
  const agent = await firstLogin(browser, agentEmail, agentTemp)
  await expect(agent).toHaveURL(/\/queue/)
  await agent.getByPlaceholder('Search ticket number, subject or requester').fill(String(stamp))
  await agent.getByRole('link', { name: new RegExp(subject) }).click()
  await expect(agent.getByRole('heading', { name: subject })).toBeVisible()
  await agent.getByTitle('Assign to me').click()
  await expect(agent.getByText('Assigned to E2E Agent')).toBeVisible()

  await agent.getByRole('button', { name: 'Internal note' }).click()
  await agent.getByPlaceholder('Only the IT team can see this note').fill('Tray 2 roller looks worn')
  await agent.getByRole('button', { name: 'Add note' }).click()
  await expect(agent.getByText('Tray 2 roller looks worn')).toBeVisible()

  await agent.getByRole('button', { name: 'Reply to requester' }).click()
  await agent.getByPlaceholder('Reply to the requester (also sent by email)').fill('Please remove tray 2 and try again.')
  await agent.getByRole('button', { name: 'Send', exact: true }).click()

  // Employee sees the public reply without reloading, but never the internal note.
  expect(employee.url()).toBe(ticketUrl)
  await expect(employee.getByText('Please remove tray 2 and try again.')).toBeVisible()
  await expect(employee.getByText('Tray 2 roller looks worn')).toHaveCount(0)

  await employee.getByPlaceholder('Write a message to IT').fill('That worked, thanks!')
  await employee.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(agent.getByText('That worked, thanks!')).toBeVisible()

  // Agent resolves; employee confirms the fix.
  await agent.getByPlaceholder(/What fixed the issue/).fill('Removed and reseated tray 2.')
  await agent.getByRole('button', { name: 'Resolve' }).click()
  await expect(employee.getByText('IT marked this as resolved')).toBeVisible()
  await employee.getByRole('button', { name: 'Yes, it is fixed' }).click()
  await expect(employee.getByText('This request is closed', { exact: true })).toBeVisible()
  await expect(agent.getByLabel('Status')).toHaveValue('CLOSED')
})
