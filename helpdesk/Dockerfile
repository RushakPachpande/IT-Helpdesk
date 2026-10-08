FROM node:24-bookworm-slim

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json prisma.config.ts ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/mail/package.json packages/mail/
RUN pnpm install --frozen-lockfile

COPY . .
# prisma.config.ts reads DATABASE_URL; generate does not connect, so a placeholder is fine.
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build pnpm exec prisma generate \
 && pnpm --filter @helpdesk/web build

ENV NODE_ENV=production
EXPOSE 8080
