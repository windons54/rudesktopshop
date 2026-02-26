# Corp Merch Store — Деплой на Timeweb.cloud

## Стек
- **Next.js 14** (стандартный режим, без standalone)
- **SQLite / sql.js** — хранение данных в браузере (IndexedDB)
- **JSON-файл** — серверное хранилище настроек (`data/store.json`)
- **Нет PostgreSQL / Prisma** — БД не требуется

---

## Деплой на Timeweb.cloud (Node.js приложение)

### Настройки в панели Timeweb

| Параметр | Значение |
|---|---|
| Команда установки | `npm install` |
| Команда сборки | `npm run build` |
| Команда запуска | `npm start` |
| Версия Node.js | 18+ |
| Корневая папка | `/` (корень репозитория) |

### Переменные окружения
Добавьте в панели Timeweb (раздел «Переменные окружения»):
- `NODE_ENV=production` (обычно устанавливается автоматически)
- `PORT` — Timeweb подставляет автоматически

---

## Локальная разработка

```bash
npm install
npm run dev       # http://localhost:3000
```

## Сборка и запуск локально

```bash
npm run build     # сборка + копирование sql-wasm.wasm в public/
npm start         # запуск на PORT=3000
```

---

## Структура проекта

```
├── pages/
│   ├── index.js          # Главная страница (SPA через dynamic import)
│   ├── _app.js
│   ├── _document.js
│   └── api/
│       ├── health.js     # GET /api/health — healthcheck для хостинга
│       ├── store.js      # POST /api/store — JSON-хранилище (настройки)
│       └── telegram.js   # POST /api/telegram — прокси Telegram Bot API
├── components/
│   └── App.jsx           # Основное SPA-приложение
├── lib/
│   ├── storage.js        # SQLite (браузер) через sql.js + IndexedDB
│   └── utils.js          # Утилиты, темы, сжатие изображений
├── scripts/
│   └── copy-wasm.js      # Копирует sql-wasm.wasm → public/ после сборки
├── styles/
│   └── globals.css
├── public/
│   └── sql-wasm.wasm     # Генерируется автоматически при npm run build
├── data/                 # Создаётся автоматически при первом запуске
│   └── store.json        # Серверное хранилище настроек
├── next.config.js
└── package.json
```

---

## Важные замечания

### Почему нет `output: 'standalone'`
Режим `standalone` генерирует минимальный сервер (`node server.js`) без `node_modules`.
Timeweb.cloud запускает приложение через `npm start` → `next start`, что несовместимо со standalone.
Поэтому используется **стандартный режим Next.js**.

### Файл `public/sql-wasm.wasm`
Копируется автоматически из `node_modules/sql.js/dist/` при:
- `npm run build`
- `npm install` (через `postinstall`)

Если файл не появился — запустите вручную: `node scripts/copy-wasm.js`

### Данные `data/store.json`
Папка `data/` создаётся автоматически. Файл содержит серверные настройки магазина.
Основные данные (товары, заказы) хранятся в **IndexedDB браузера** через sql.js.
