# Corp Merch Store — Next.js

Корпоративный магазин мерча на Next.js 14 с PostgreSQL.

## Технологии
- **Next.js 14** (Pages Router, standalone output)
- **React 18**
- **Prisma** — ORM для PostgreSQL
- **sql.js** — SQLite в браузере (для экспорта/импорта)
- **xlsx** — экспорт/импорт данных

---

## Деплой на Timeweb Cloud

### Подготовка

1. **Создайте PostgreSQL-базу** в Timeweb Cloud:
   - Перейдите в «Базы данных» → «Создать» → PostgreSQL
   - Запишите хост, порт, имя БД, логин и пароль
   - Сформируйте строку: `postgresql://user:password@host:port/dbname?sslmode=require`

2. **Загрузите код в GitHub-репозиторий**:
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin https://github.com/YOUR_USER/YOUR_REPO.git
   git push -u origin main
   ```

### Деплой через Dockerfile (рекомендуется)

Timeweb Cloud Apps для Next.js поддерживает только static build.
Поскольку приложение использует API Routes, деплой выполняется через **Dockerfile**.

1. Перейдите в панель Timeweb Cloud → **Apps** → **Создать**
2. Выберите тип: **Dockerfile**
3. Подключите GitHub-репозиторий
4. Задайте **переменные окружения** (ENV):

   | Переменная      | Значение                                              |
   |-----------------|-------------------------------------------------------|
   | `DATABASE_URL`  | `postgresql://user:pass@host:5432/dbname?sslmode=require` |
   | `NODE_ENV`      | `production`                                          |
   | `PORT`          | `3000`                                                |

   Необязательные:
   | Переменная      | Описание                                              |
   |-----------------|-------------------------------------------------------|
   | `DEBUG_SECRET`  | Секрет для доступа к `/api/debug` и `/api/dbkeys`     |

5. Нажмите **Запустить деплой**
6. Дождитесь сборки (~3–5 мин)
7. Откройте публичный URL — магазин готов!

### Деплой на VPS/облачный сервер (альтернатива)

```bash
# На сервере:
git clone https://github.com/YOUR_USER/YOUR_REPO.git
cd YOUR_REPO

# Установка
npm ci
npx prisma generate
npx prisma migrate deploy

# Сборка
npm run build

# Запуск (через pm2 для стабильности)
npm install -g pm2
DATABASE_URL="postgresql://..." pm2 start npm --name "merch-store" -- start
```

---

## Локальный запуск

```bash
# Без PostgreSQL (данные в JSON-файле):
npm install
npm run dev

# С PostgreSQL:
echo 'DATABASE_URL=postgresql://user:pass@localhost:5432/merchdb' > .env
npm install
npx prisma migrate dev
npm run dev
```

Открыть http://localhost:3000

---

## Переменные окружения

| Переменная       | Обязательно | Описание                                    |
|------------------|-------------|---------------------------------------------|
| `DATABASE_URL`   | Да*         | Строка подключения к PostgreSQL              |
| `NODE_ENV`       | —           | `production` / `development`                |
| `PORT`           | —           | Порт сервера (по умолчанию 3000)            |
| `DEBUG_SECRET`   | —           | Токен для `/api/debug` и `/api/dbkeys`      |

\* Без `DATABASE_URL` приложение использует JSON-файл — данные потеряются при рестарте контейнера.

---

## Структура проекта

```
├── Dockerfile             # Docker-образ для Timeweb Cloud
├── .dockerignore
├── next.config.js         # standalone output для Docker
├── package.json
├── prisma/
│   └── schema.prisma      # Модель KV-хранилища
├── components/
│   └── App.jsx            # Основной SPA-компонент
├── pages/
│   ├── index.js           # Точка входа (CSR)
│   ├── _app.js
│   ├── _document.js
│   └── api/
│       ├── store.js       # CRUD для KV-хранилища (Prisma / JSON)
│       ├── pg.js          # PostgreSQL: test, stats, migrate, query
│       ├── telegram.js    # Прокси для Telegram Bot API
│       ├── debug.js       # Диагностика (защищён DEBUG_SECRET)
│       └── dbkeys.js      # Просмотр ключей БД (защищён)
├── lib/
│   ├── prisma.js          # Prisma singleton
│   ├── storage.js         # SQLite + PG storage (клиент)
│   └── utils.js           # Темы, сжатие изображений
└── styles/
    └── globals.css
```
