#!/bin/sh
# Применяем миграции при наличии DATABASE_URL (безопасно, idempotent)
if [ -n "$DATABASE_URL" ]; then
  echo "[start] Применяем миграции Prisma..."
  npx prisma migrate deploy
fi

# Если есть SSL-сертификаты — используем кастомный сервер с HTTPS
if [ -f "./ssl/cert.pem" ] && [ -f "./ssl/key.pem" ]; then
  echo "[start] SSL-сертификаты найдены, запускаем с поддержкой HTTPS..."
  exec node server.js
else
  echo "[start] Запускаем сервер (HTTP)..."
  exec node_modules/.bin/next start
fi
