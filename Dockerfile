FROM node:20-alpine

WORKDIR /app

# Зависимости
COPY package.json package-lock.json* ./
COPY prisma ./prisma/
RUN npm install

# Исходники
COPY . .

# WASM для sql.js
RUN mkdir -p public && \
    cp node_modules/sql.js/dist/sql-wasm.wasm public/sql-wasm.wasm 2>/dev/null || true

# Сборка
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
RUN npm run build

# Директория для данных (fallback без БД) — объявляем volume для сохранения при деплоях
RUN mkdir -p data
VOLUME ["/app/data"]

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["npm", "start"]
