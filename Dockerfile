# syntax=docker/dockerfile:1
FROM node:22-alpine AS base
LABEL org.opencontainers.image.source="https://github.com/SchulzOli/postwerk" \
      org.opencontainers.image.description="Self-hosted social media scheduler" \
      org.opencontainers.image.licenses="MIT"
WORKDIR /app

FROM base AS build
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/providers/package.json packages/providers/
RUN npm ci
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build -w @postwerk/worker && npm run build -w @postwerk/web

# Publishing worker (also runs database migrations via `node dist/migrate.js`).
FROM base AS worker
ENV NODE_ENV=production MEDIA_DIR=/data/media
COPY --from=build /app/apps/worker/dist ./dist
COPY --from=build /app/packages/db/drizzle ./drizzle
# Uploads (shared with the web app through a volume); owned by node so a fresh volume is writable.
RUN mkdir -p /data/media && chown node:node /data/media
USER node
CMD ["node", "dist/index.js"]

# Web app (Next.js standalone server).
FROM base AS web
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 MEDIA_DIR=/data/media
COPY --from=build /app/apps/web/.next/standalone ./
RUN mkdir -p /data/media && chown node:node /data/media
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
