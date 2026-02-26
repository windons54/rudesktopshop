# Corp Merch Store — Next.js

Корпоративный магазин мерча, конвертированный из HTML в Next.js.

## Технологии
- **Next.js 14** (Pages Router)
- **React 18**
- **sql.js** — SQLite в браузере (хранение данных в IndexedDB)
- **xlsx** — экспорт/импорт данных

## Локальный запуск

```bash
# 1. Установить зависимости (скопирует sql-wasm.wasm автоматически)
npm install

# 2. Запустить dev-сервер
npm run dev

# 3. Открыть http://localhost:3000
```

## Деплой на Vercel

### Способ 1 — через GitHub (рекомендуется)

1. Создайте репозиторий на GitHub и загрузите проект:
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin https://github.com/YOUR_USER/YOUR_REPO.git
   git push -u origin main
   ```

2. Зайдите на [vercel.com](https://vercel.com) → **New Project**

3. Выберите ваш GitHub репозиторий

4. Настройки оставьте по умолчанию (Vercel автоматически определит Next.js):
   - **Framework Preset**: Next.js
   - **Build Command**: `npm run build`
   - **Install Command**: `npm install`

5. Нажмите **Deploy** — через ~1 минуту сайт будет доступен

### Способ 2 — Vercel CLI

```bash
npm i -g vercel
vercel login
vercel --prod
```

## Структура проекта

```
├── pages/
│   ├── _app.js          # Глобальные стили
│   ├── _document.js     # HTML шаблон
│   └── index.js         # Главная страница
├── components/
│   └── App.jsx          # Вся логика приложения (SPA)
├── lib/
│   ├── storage.js       # SQLite/IndexedDB слой
│   └── utils.js         # Утилиты
├── styles/
│   └── globals.css      # Все стили
├── public/
│   └── sql-wasm.wasm    # WebAssembly для SQLite (копируется при npm install)
├── scripts/
│   └── copy-wasm.js     # Postinstall скрипт
└── next.config.js
```

## Важно

- Все данные хранятся **в браузере пользователя** (IndexedDB + SQLite in-memory)
- При очистке кэша браузера данные удаляются — используйте экспорт БД в настройках
- Это **клиентское SPA**, серверные компоненты не используются

## Логин администратора

- **Логин**: `admin`
- **Пароль**: `admin123`

---

## Prisma (ORM)

Проект использует **Prisma ORM** для работы с PostgreSQL вместо сырых SQL-запросов.

### Быстрый старт

1. **Скопируй `.env.example` в `.env`** и заполни `DATABASE_URL`:
   ```
   cp .env.example .env
   ```

2. **Установи зависимости** (Prisma Client генерируется автоматически через `postinstall`):
   ```bash
   npm install
   ```

3. **Применить миграции** (создаст таблицу `kv` в БД):
   ```bash
   npm run prisma:migrate
   ```

4. **Запустить проект:**
   ```bash
   npm run dev
   ```

### Команды Prisma

| Команда | Описание |
|---|---|
| `npm run prisma:generate` | Сгенерировать Prisma Client |
| `npm run prisma:migrate` | Применить миграции (prod) |
| `npm run prisma:migrate:dev` | Создать и применить миграцию (dev) |
| `npm run prisma:studio` | Открыть Prisma Studio (GUI для БД) |

### Схема базы данных

```prisma
model Kv {
  key        String   @id
  value      String
  updated_at DateTime @default(now()) @updatedAt

  @@map("kv")
}
```

Таблица `kv` используется как универсальное хранилище ключ-значение для настроек и данных магазина. Если `DATABASE_URL` не задан — данные сохраняются в `data/store.json` (режим локальной разработки).
