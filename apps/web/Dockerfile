# syntax=docker/dockerfile:1.7
FROM node:26-alpine AS base
# Node.js 26 no longer ships Corepack, so install it before enabling pnpm.
RUN apk add --no-cache openssl libc6-compat \
  && npm install -g corepack@latest \
  && corepack enable
WORKDIR /repo

FROM base AS dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/
COPY packages/database/package.json packages/database/
COPY packages/shared/package.json packages/shared/
COPY packages/observability/package.json packages/observability/
RUN pnpm install --frozen-lockfile

FROM dependencies AS build
COPY . .
RUN pnpm --filter @docuflow/web build

FROM base AS runner
ENV NODE_ENV=production
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
