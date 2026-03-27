# Stage 1: Build nexus-workflow-core
FROM node:22-alpine AS core-builder
WORKDIR /monorepo/nexus-workflow-core
COPY nexus-workflow-core/package.json nexus-workflow-core/package-lock.json ./
RUN npm ci
COPY nexus-workflow-core/src ./src
COPY nexus-workflow-core/tsconfig.json nexus-workflow-core/tsconfig.build.json ./
RUN npm run build && npm prune --omit=dev

# Stage 2: Build nexus-workflow-app
# Core's dist/ must exist before npm ci so the file: dep resolves correctly
FROM node:22-alpine AS app-builder
WORKDIR /monorepo
COPY nexus-workflow-core/package.json nexus-workflow-core/
COPY --from=core-builder /monorepo/nexus-workflow-core/dist nexus-workflow-core/dist/
WORKDIR /monorepo/nexus-workflow-app
COPY nexus-workflow-app/package.json nexus-workflow-app/package-lock.json ./
RUN npm ci
COPY nexus-workflow-app/src ./src
COPY nexus-workflow-app/tsconfig.json ./
RUN npm run build && npm prune --omit=dev

# Stage 3: Minimal runtime image
# Keep the monorepo directory layout so the node_modules/nexus-workflow-core
# symlink (file: dep) resolves to the correct relative path at runtime.
FROM node:22-alpine AS runtime
WORKDIR /monorepo
# Core dist + node_modules: Node follows the node_modules/nexus-workflow-core
# symlink to this real path, so core's own deps (fast-xml-parser) must be here.
COPY --from=core-builder /monorepo/nexus-workflow-core/dist nexus-workflow-core/dist/
COPY --from=core-builder /monorepo/nexus-workflow-core/node_modules nexus-workflow-core/node_modules/
COPY nexus-workflow-core/package.json nexus-workflow-core/
WORKDIR /monorepo/nexus-workflow-app
COPY --from=app-builder /monorepo/nexus-workflow-app/dist ./dist
COPY --from=app-builder /monorepo/nexus-workflow-app/node_modules ./node_modules
COPY nexus-workflow-app/package.json ./
# SQL migration files are not emitted by tsc — copy them alongside the compiled output
COPY nexus-workflow-app/src/db/migrations ./dist/db/migrations/
ENV NODE_ENV=production
EXPOSE 3000
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser
CMD ["node", "dist/main.js"]
