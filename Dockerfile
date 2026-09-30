# Stage 1: Install deps and build core + app
FROM node:24-alpine AS builder
RUN npm install -g pnpm@12.6.0
WORKDIR /monorepo
# Manifests first so the install layer is cached until dependencies change.
# nexus-erp/package.json must be present (see .dockerignore): the lockfile
# lists it as a workspace project even though it is not built here.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY nexus-workflow-core/package.json nexus-workflow-core/
COPY nexus-workflow-app/package.json nexus-workflow-app/
COPY nexus-erp/package.json nexus-erp/
RUN pnpm install --frozen-lockfile --filter nexus-workflow-app...

COPY nexus-workflow-core/src nexus-workflow-core/src
COPY nexus-workflow-core/tsconfig.json nexus-workflow-core/tsconfig.build.json nexus-workflow-core/
RUN pnpm --filter nexus-workflow-core build

COPY nexus-workflow-app/src nexus-workflow-app/src
COPY nexus-workflow-app/tsconfig.json nexus-workflow-app/
RUN pnpm --filter nexus-workflow-app build

# Self-contained production bundle: app + prod deps, with core copied in
# (not symlinked), so no monorepo layout is needed at runtime.
RUN pnpm --filter nexus-workflow-app deploy --prod /out

# Stage 2: Minimal runtime image
FROM node:24-alpine AS runtime
WORKDIR /app
COPY --from=builder /out/node_modules ./node_modules
COPY --from=builder /out/package.json ./
COPY --from=builder /monorepo/nexus-workflow-app/dist ./dist
# SQL migration files are not emitted by tsc — copy them alongside the compiled output
COPY nexus-workflow-app/src/db/migrations ./dist/db/migrations/
ENV NODE_ENV=production
EXPOSE 3000
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser
CMD ["node", "dist/main.js"]
