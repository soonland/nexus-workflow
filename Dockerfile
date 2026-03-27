# Stage 1: Build nexus-workflow-core
FROM node:22-alpine AS core-builder
WORKDIR /monorepo/nexus-workflow-core
COPY nexus-workflow-core/package.json nexus-workflow-core/package-lock.json ./
RUN npm ci
COPY nexus-workflow-core/src ./src
COPY nexus-workflow-core/tsconfig.json nexus-workflow-core/tsconfig.build.json ./
RUN npm run build

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
RUN npm run build

# Stage 3: Minimal runtime image
FROM node:22-alpine AS runtime
WORKDIR /app
COPY --from=app-builder /monorepo/nexus-workflow-app/dist ./dist
COPY --from=app-builder /monorepo/nexus-workflow-app/node_modules ./node_modules
COPY nexus-workflow-app/package.json ./
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "dist/main.js"]
