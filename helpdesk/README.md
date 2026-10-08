# IT Helpdesk

Self-hosted IT ticketing for the office LAN. Employees sign in with their company email and raise tickets; IT agents triage, chat and resolve them; the IT mailbox (Microsoft 365 or Gmail) is synced so emailed requests become tickets and replies go out by email.

Everything runs on one machine with Docker Compose: Postgres, the API (which also serves the web app), a background worker and a daily backup job.

| Part | Tech |
| --- | --- |
| Web | React 19, Vite, TanStack Router/Query, Tailwind |
| API | Node 22+, Fastify 5, Prisma 7, Socket.IO |
| Jobs | pg-boss (mail sync, outbound mail, AI summary, cleanup) |
| Mail | Microsoft Graph (MSAL), Gmail API |

## 1. First-time setup (Docker)

Requirements: Docker Desktop (or Docker Engine with Compose v2).

1. Copy the template and edit it:

   ```powershell
   Copy-Item .env.example .env
   ```

2. Fill in at least:
   - `APP_ENCRYPTION_KEY`: generate with
     `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.
     It encrypts the mailbox tokens and AI key. **Keep it safe; if it changes, the mailbox must be reconnected.** The app refuses to start without a valid key.
   - `POSTGRES_PASSWORD`, and the same password inside `DATABASE_URL`.
   - `APP_PUBLIC_URL`: the address employees will open, for example `http://192.168.1.10:8080`. It is used in email links.
   - `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`, `SEED_ALLOWED_DOMAIN`: the first admin account and company domain.
   - The `MS_*` and/or `GOOGLE_*` values (see sections 3 and 4). These can be added later; restart the stack afterwards.

3. Start:

   ```powershell
   docker compose up -d --build
   ```

   The `migrate` service applies database migrations and creates the first admin (only if no admin exists yet), then `api`, `worker` and `backup` start.

4. Open `http://localhost:8080`, sign in as the seed admin and change the password when prompted. Then, under **Admin**:
   - **Domains**: confirm the allowed email domains. Tick "include subdomains" where needed.
   - **Users**: create employees and agents. Each new user gets a temporary password to share with them and must change it at first sign-in.
   - **Lists**: categories (types of issue) and priorities.
   - **Settings**: ticket number format, attachment limits, email templates, optional AI.
   - **Mailbox**: connect the IT mailbox (from this machine; see "OAuth only from localhost" below).

Useful commands:

```powershell
docker compose ps                     # status
docker compose logs -f api worker     # logs
docker compose down                   # stop (data is kept in volumes)
docker compose up -d --build          # update after pulling new code
```

## 2. LAN access

The app listens on port 8080 on all interfaces. Other computers use `APP_PUBLIC_URL`.

- Give the host a fixed IP (a DHCP reservation on the router is easiest).
- Allow the port through Windows Firewall from an elevated PowerShell:

  ```powershell
  New-NetFirewallRule -DisplayName "IT Helpdesk 8080" -Direction Inbound -Protocol TCP -LocalPort 8080 -Action Allow -Profile Private,Domain
  ```

  Make sure the office network is set to *Private* (or *Domain*), not *Public*.
- Postgres is published on `127.0.0.1:5433` only, so it can't be reached from the LAN.
- Traffic is plain HTTP. Keep `COOKIE_SECURE=false` unless you put the app behind an HTTPS reverse proxy, in which case set it to `true`.

## 3. Microsoft 365 mailbox (Entra ID app registration)

In the [Microsoft Entra admin center](https://entra.microsoft.com) go to **App registrations → New registration**:

1. **Supported account types**: *Accounts in this organizational directory only* (single tenant).
2. **Redirect URI**: platform **Web**, URI `http://localhost:8080/api/mailbox/oauth/microsoft/callback`. Entra only allows plain `http` for `localhost`. If you changed `OAUTH_REDIRECT_BASE` or the port, use that value instead.
3. After creating it, copy the **Application (client) ID** to `MS_CLIENT_ID` and the **Directory (tenant) ID** to `MS_TENANT_ID`.
4. **Certificates & secrets → New client secret**: copy the secret *Value* (not the ID) to `MS_CLIENT_SECRET`. Note the expiry date and create a new secret before it expires.
5. **API permissions → Add → Microsoft Graph → Delegated**: `offline_access`, `User.Read`, `Mail.ReadWrite`, `Mail.Send`. Click **Grant admin consent** if your tenant requires it.
6. Restart (`docker compose up -d`). Then, on the host machine, open `http://localhost:8080/admin/mailbox` and click **Sign in with Microsoft** as the IT mailbox account itself. The app reads the signed-in account's own mailbox (`/me`), so a shared mailbox reached through someone else's delegated access is not supported.

Sync uses the Graph delta query on the Inbox. On first connect it imports only recent messages (**Settings → "On first connect, import last (minutes)"**, default 60), not the whole mailbox history.

## 4. Gmail / Google Workspace mailbox

In the [Google Cloud console](https://console.cloud.google.com):

1. Create (or pick) a project and enable the **Gmail API**.
2. **OAuth consent screen**: for a Google Workspace account choose user type **Internal**. Use *External* only for a personal Gmail account. An External app left in *Testing* status gets refresh tokens that expire after 7 days, so the mailbox would disconnect weekly; publish it or use Internal.
3. Add the scope `https://www.googleapis.com/auth/gmail.modify`. It is needed to read, label and send.
4. **Credentials → Create OAuth client ID → Web application**, with authorised redirect URI `http://localhost:8080/api/mailbox/oauth/google/callback`.
5. Copy the client ID and secret to `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, restart, then click **Sign in with Google** on the Mailbox page from the host machine.

Sync uses Gmail `history.list`. Replies are sent in the original Gmail thread.

## 5. How email maps to tickets

- **New email from an allowed domain**: creates a ticket. If the sender has no account, a placeholder user is created. An admin activates it by creating a user with that email (or with **Reset password**), and the existing tickets stay linked.
- **Email from outside the allowed domains**: goes to **Needs Review** with no auto-reply. Agents accept it (optionally sending the acknowledgement) or discard it.
- **Reply to an existing ticket**: added to the conversation. Matching uses email thread headers first, then the ticket number in the subject.
- Auto-replies, bounces and the mailbox's own messages are ignored. Quoted history and signatures are stripped.
- Agent replies (not internal notes) are emailed to the requester. Status-change emails use the templates in **Settings**.
- **Shadow mode** (Mailbox page): inbound email is imported, but nothing is ever sent. It is meant for the cutover below.

## 6. Moving over from the n8n workflow

1. Connect the mailbox with **Shadow mode on** while the n8n workflow keeps running. The app imports email but sends nothing, so requesters don't get double replies.
2. For a few days, compare the tickets created in both systems: senders, threading, cleaned bodies, Needs Review decisions.
3. Agree a cutover time. Then deactivate the n8n workflow, turn **Shadow mode off**, and check the Mailbox page's event log and outbound table for the first real replies.
4. Keep the n8n workflow exported (not deleted) for a short rollback window, then archive it.

## 7. Backups and restore

The `backup` service runs at start-up and then every 24 hours. It writes two files to `./backups/`:

- `helpdesk-YYYYMMDD-HHMMSS.sql.gz`: database dump;
- `uploads-YYYYMMDD-HHMMSS.tar.gz`: ticket attachments.

Files older than `BACKUP_KEEP_DAYS` (default 14) are deleted. Copy `./backups` to another disk or a NAS regularly, and keep `APP_ENCRYPTION_KEY` with them.

To restore (this replaces the current data), run from the `helpdesk` folder:

```powershell
docker compose stop api worker
docker compose exec db sh -c 'dropdb -U "$POSTGRES_USER" "$POSTGRES_DB" && createdb -U "$POSTGRES_USER" "$POSTGRES_DB"'
docker compose exec -T db sh -c 'gunzip | psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < backups\helpdesk-YYYYMMDD-HHMMSS.sql.gz
docker run --rm -v helpdesk_uploads:/uploads -v "${PWD}\backups:/b" alpine sh -c "rm -rf /uploads/* && tar -xzf /b/uploads-YYYYMMDD-HHMMSS.tar.gz -C /uploads"
docker compose up -d
```

## 8. Development

Requirements: Node 22+ and pnpm 9 (`corepack enable`).

```powershell
pnpm install
docker compose up -d db      # Postgres only, on localhost:5433
pnpm db:migrate              # apply migrations (dev)
pnpm db:generate             # Prisma client
pnpm db:seed                 # first admin
pnpm dev                     # API on :8080 + Vite on :5173
pnpm dev:worker              # background jobs (separate terminal)
```

When testing OAuth through the Vite dev server, set `OAUTH_REDIRECT_BASE=http://localhost:5173` and register that redirect URI too.

Tests:

| Command | What it runs |
| --- | --- |
| `pnpm test` | Unit tests: email cleaning, filters, Graph/Gmail parsers, ticket numbers, settings, AI parsing |
| `pnpm test:db` | Database tests (needs Postgres from `DATABASE_URL`), for example concurrent ticket numbering |
| `pnpm test:e2e` | Playwright full ticket lifecycle against a running app (`E2E_BASE_URL`, `E2E_ADMIN_EMAIL`, `E2E_ADMIN_PASSWORD`, `E2E_DOMAIN`) |
| `pnpm typecheck` | TypeScript across all packages |

The e2e test creates real users and tickets, so run it against a dev or test database, not production.

## 9. Known limits

- **OAuth only from localhost.** Microsoft and Google don't accept plain-HTTP LAN addresses as redirect URIs, so mailbox sign-in must be done in a browser on the host machine (`http://localhost:8080/admin/mailbox`). Everything else works from any LAN computer.
- **One mailbox** at a time.
- **Outgoing attachments over 3 MB (Microsoft)** are not attached to the email. The outbound log on the Mailbox page lists the files that were left out, and the requester can still open them in the app.
- **Gmail threading**: Gmail groups replies by subject as well as headers. A requester who edits the subject may start a new Gmail thread. The app still matches the reply while the `[ticket number]` stays in the subject; otherwise it becomes a new ticket.
- **Plain HTTP** on the LAN unless you add an HTTPS reverse proxy.
- **AI** (optional) sends ticket text to the configured provider (OpenRouter or Groq). Leave it off if that isn't acceptable. Ticket creation never waits for it.
