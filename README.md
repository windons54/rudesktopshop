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
