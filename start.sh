#!/bin/sh
# Применяем миграции при наличии DATABASE_URL (безопасно, idempotent)
if [ -n "$DATABASE_URL" ]; then
  echo "[start] Применяем миграции Prisma..."
  npx prisma migrate deploy
fi
echo "[start] Запускаем сервер..."
exec node_modules/.bin/next start
