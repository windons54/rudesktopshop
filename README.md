# Corp Merch Store — Next.js

Корпоративный магазин мерча на Next.js 14 + PostgreSQL.

## Технологии
- **Next.js 14** (Pages Router, standalone output)
- **React 18**
- **Prisma ORM** + PostgreSQL (продакшен)
- **sql.js** — SQLite в браузере (импорт/экспорт)
- **xlsx** — экспорт/импорт данных

## Локальный запуск

```bash
cp .env.example .env          # заполнить DATABASE_URL
npm install
npm run prisma:migrate         # создать таблицу kv в БД
npm run dev                    # http://localhost:3000
```

## Деплой на Timeweb Cloud

### 1. Создать PostgreSQL базу данных

1. Перейдите в [Timeweb Cloud](https://timeweb.cloud/) → **Базы данных** → **Создать**
2. Выберите **PostgreSQL**, задайте имя, пользователя и пароль
3. Скопируйте строку подключения вида:
   ```
   postgresql://USER:PASSWORD@HOST:PORT/DATABASE
   ```

### 2. Загрузить код в Git-репозиторий

```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/YOUR_USER/YOUR_REPO.git
git push -u origin main
```

### 3. Создать приложение в App Platform

1. Перейдите в **App Platform** → **Создать**
2. Тип: **Docker** → **Dockerfile**
3. Подключите GitHub/GitLab репозиторий
4. Задайте переменные окружения:
   - `DATABASE_URL` — строка подключения PostgreSQL из шага 1
   - `NODE_ENV` — `production`
5. Путь проверки состояния (Health Check): `/api/health`
6. Нажмите **Запустить деплой**

Таблица `kv` создаётся автоматически при первом запросе к API.

### Альтернатива: VPS / Cloud Server

```bash
git clone https://github.com/YOUR_USER/YOUR_REPO.git
cd YOUR_REPO
cp .env.example .env           # заполнить DATABASE_URL
npm install
npm run build
npm run prisma:migrate
npm start                      # или: pm2 start npm --name merch -- start
```

## Структура проекта

```
├── Dockerfile              # Docker-сборка для Timeweb App Platform
├── .dockerignore
├── pages/
│   ├── index.js            # Главная страница (CSR)
│   └── api/
│       ├── health.js       # Health check для мониторинга
│       ├── store.js        # CRUD API (Prisma → PG)
│       ├── pg.js           # PG-утилиты
│       ├── telegram.js     # Telegram Bot API прокси
│       └── debug.js        # Диагностика
├── components/
│   └── App.jsx             # Логика приложения (SPA)
├── lib/
│   └── prisma.js           # Prisma singleton
├── prisma/
│   └── schema.prisma       # Схема БД
└── next.config.js          # standalone output
```

## Логин администратора

- **Логин**: `admin`
- **Пароль**: `admin123`
