# Инструкция по сборке и запуску Docker контейнера

## Проблема, которую мы исправили

В оригинальном Dockerfile была ошибка на строке 39:
```dockerfile
RUN npm run build npm start
```

Это неправильная команда. `npm run build` и `npm start` — это две отдельные команды, которые нельзя запускать вместе таким образом.

## Что было исправлено

1. **Разделены команды** - `build` и `start` выполняются на разных этапах
2. **Добавлен multi-stage build** - оптимизация размера образа
3. **Добавлен standalone режим** - Next.js создаст оптимизированный standalone сервер
4. **Улучшена безопасность** - использование непривилегированного пользователя

## Как собрать и запустить

### 1. Подготовка

Убедитесь, что у вас есть файл `.env` с необходимыми переменными окружения:

```env
# Database
DATABASE_URL="postgresql://user:password@localhost:5432/dbname"

# Telegram Bot (опционально)
TELEGRAM_BOT_TOKEN=your_token_here
TELEGRAM_CHAT_ID=your_chat_id_here

# Next.js
NODE_ENV=production
```

### 2. Сборка Docker образа

```bash
docker build -t rudesktopshop:latest .
```

### 3. Запуск контейнера

#### Вариант А: С PostgreSQL на хосте
```bash
docker run -d \
  --name rudesktopshop \
  -p 3000:3000 \
  --env-file .env \
  rudesktopshop:latest
```

#### Вариант Б: С docker-compose (рекомендуется)

Создайте файл `docker-compose.yml`:

```yaml
version: '3.8'

services:
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: rudesktopshop
    volumes:
      - postgres_data:/var/lib/postgresql/data
    ports:
      - "5432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
      timeout: 5s
      retries: 5

  app:
    build: .
    ports:
      - "3000:3000"
    environment:
      DATABASE_URL: postgresql://postgres:postgres@db:5432/rudesktopshop
      NODE_ENV: production
    depends_on:
      db:
        condition: service_healthy
    command: >
      sh -c "
        npx prisma migrate deploy &&
        node server.js
      "

volumes:
  postgres_data:
```

Затем запустите:
```bash
docker-compose up -d
```

### 4. Проверка работы

Откройте в браузере: http://localhost:3000

### 5. Просмотр логов

```bash
# Docker
docker logs -f rudesktopshop

# Docker Compose
docker-compose logs -f app
```

## Миграции базы данных

Если нужно выполнить миграции базы данных:

```bash
# Войти в контейнер
docker exec -it rudesktopshop sh

# Выполнить миграции
npx prisma migrate deploy
```

## Отладка

Если возникают проблемы:

```bash
# Проверить, что контейнер запущен
docker ps

# Проверить логи
docker logs rudesktopshop

# Проверить переменные окружения
docker exec rudesktopshop env

# Проверить подключение к БД
docker exec rudesktopshop npx prisma db push --skip-generate
```

## Остановка и удаление

```bash
# Остановить контейнер
docker stop rudesktopshop

# Удалить контейнер
docker rm rudesktopshop

# Удалить образ
docker rmi rudesktopshop:latest

# Для docker-compose
docker-compose down
docker-compose down -v  # с удалением volumes
```

## Размер образа

Благодаря multi-stage build итоговый образ будет значительно меньше.

Проверить размер:
```bash
docker images rudesktopshop
```
