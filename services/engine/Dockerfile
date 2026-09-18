# Herald engine.
#
# The Playwright base image carries Chromium and its system libraries, which the
# submit step needs. Building from node:slim and installing them by hand saves a
# few hundred MB but breaks on every Chromium bump, so this is the trade we take
# for a service that has to keep working unattended.
#
# Build from the repo root:
#   docker build -f services/engine/Dockerfile -t herald-engine .
FROM mcr.microsoft.com/playwright:v1.56.0-noble AS build

WORKDIR /app
ENV NODE_ENV=development

# Manifests first, so `npm ci` stays cached until a dependency actually moves.
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY services/engine/package.json services/engine/
RUN npm ci --workspace @herald/core --workspace @herald/engine --include-workspace-root

COPY tsconfig.base.json ./
COPY packages/core packages/core
COPY services/engine services/engine
RUN npm run build --workspace @herald/core \
 && npm run build --workspace @herald/engine

# ── runtime ──────────────────────────────────────────────────────────────────
FROM mcr.microsoft.com/playwright:v1.56.0-noble

WORKDIR /app
ENV NODE_ENV=production \
    HERALD_DATA_DIR=/data \
    HERALD_HOST=0.0.0.0 \
    HERALD_PORT=8787

COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY services/engine/package.json services/engine/
RUN npm ci --omit=dev --workspace @herald/core --workspace @herald/engine --include-workspace-root \
 && npm cache clean --force

COPY --from=build /app/packages/core/dist packages/core/dist
COPY --from=build /app/services/engine/dist services/engine/dist
COPY services/engine/config services/engine/config
COPY services/engine/herald.config.example.json services/engine/

# The SQLite file, the stored resume and confirmation screenshots all live here.
# Mount a volume, or every restart starts from nothing.
RUN mkdir -p /data && chown -R pwuser:pwuser /data
VOLUME ["/data"]
EXPOSE 8787

# The Playwright image ships a non-root user; use it.
USER pwuser

HEALTHCHECK --interval=60s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.HERALD_PORT||8787)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "services/engine/dist/index.js"]
