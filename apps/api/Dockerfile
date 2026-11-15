# syntax=docker/dockerfile:1.7
FROM node:22-alpine AS base
RUN corepack enable && apk add --no-cache openssl libc6-compat
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
RUN pnpm --filter @docuflow/database build \
  && pnpm --filter @docuflow/observability build \
  && pnpm --filter @docuflow/shared build \
  && pnpm --filter @docuflow/api build

FROM base AS runner
ENV NODE_ENV=production
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/apps/api/node_modules ./apps/api/node_modules
COPY --from=build /repo/apps/api/dist ./apps/api/dist
COPY --from=build /repo/apps/api/package.json ./apps/api/package.json
COPY --from=build /repo/packages/database ./packages/database
COPY --from=build /repo/packages/observability ./packages/observability
COPY --from=build /repo/packages/shared ./packages/shared
COPY --from=build /repo/package.json ./package.json
USER node
EXPOSE 4000
CMD ["node", "apps/api/dist/main.js"]
