# ── Stage 1: deps ─────────────────────────────────────────────
FROM node:18-alpine AS deps
WORKDIR /app

COPY package.json package-lock.json* ./
COPY prisma ./prisma/

RUN npm ci --ignore-scripts \
 && npx prisma generate

# ── Stage 2: build ────────────────────────────────────────────
FROM node:18-alpine AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/package.json ./package.json
COPY . .

# Копируем sql-wasm.wasm в public/ перед билдом
RUN mkdir -p public \
 && cp node_modules/sql.js/dist/sql-wasm.wasm public/sql-wasm.wasm 2>/dev/null || true

# Next.js собирает standalone-приложение
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ── Stage 3: production ──────────────────────────────────────
FROM node:18-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000

RUN addgroup --system --gid 1001 nodejs \
 && adduser  --system --uid 1001 nextjs

# Standalone output + static files
COPY --from=builder /app/public                       ./public
COPY --from=builder /app/.next/standalone              ./
COPY --from=builder /app/.next/static                  ./.next/static

# Prisma client
COPY --from=builder /app/node_modules/.prisma          ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma           ./node_modules/@prisma
COPY --from=builder /app/prisma                         ./prisma

# Каталог data/ для fallback JSON-хранилища (если нет БД)
RUN mkdir -p /app/data && chown nextjs:nodejs /app/data

USER nextjs

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/ || exit 1

CMD ["node", "server.js"]
