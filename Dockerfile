# ── Stage 1: Dependencies ──────────────────────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

# ── Stage 2: Build ─────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Копируем sql-wasm.wasm в public/ ДО сборки, чтобы Next.js включил его в standalone
RUN mkdir -p public && \
    cp node_modules/sql.js/dist/sql-wasm.wasm public/sql-wasm.wasm

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
RUN npm run build

# ── Stage 3: Production ────────────────────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# 1. Сначала standalone-сервер (содержит server.js + node_modules трейс)
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./

# 2. Статика — ОБЯЗАТЕЛЬНО рядом с server.js (standalone её не включает)
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# 3. Public-файлы — рядом с server.js (включая sql-wasm.wasm для браузера)
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

# 4. sql.js — standalone-трейс может пропустить нативные модули с wasm
#    Копируем явно чтобы гарантировать наличие в контейнере
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/sql.js ./node_modules/sql.js

# 5. Папка для data/store.json (серверное JSON-хранилище)
RUN mkdir -p data && chown nextjs:nodejs data

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1

# standalone запускается через node server.js — НЕ через npm start или next start
CMD ["node", "server.js"]
