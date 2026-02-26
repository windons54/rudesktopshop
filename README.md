# Corp Merch Store — Next.js

Корпоративный магазин мерча на Next.js + PostgreSQL, деплой на Timeweb Cloud.

## Технологии

- **Next.js 14** (Pages Router) + **React 18**
- **Prisma ORM** + **PostgreSQL** — серверное хранилище
- **JSON-файл** (`data/store.json`) — fallback для локальной разработки без БД

## Хранение данных

Все данные (товары, категории, пользователи, заказы, настройки) хранятся **на сервере в PostgreSQL**.  
При пересборке/обновлении с GitHub данные **не теряются** — таблица `kv` сохраняется в БД.

| Среда | Хранилище | Персистентность |
|---|---|---|
| `DATABASE_URL` задан | PostgreSQL (Prisma) | ✅ Сохраняется при деплоях |
| Без `DATABASE_URL` | `data/store.json` | ⚠️ Теряется при пересборке контейнера |

---

## Деплой на Timeweb Cloud (Docker)

### 1. Создай сервис приложения в Timeweb Cloud

1. Перейди в панель Timeweb Cloud → **Apps** → **Создать приложение**
2. Выбери **Docker** или подключи **GitHub-репозиторий**
3. Укажи **Dockerfile** в корне проекта (он уже там)

### 2. Создай базу данных PostgreSQL

1. В Timeweb Cloud → **Базы данных** → **Создать** → PostgreSQL
2. Запиши: хост, порт, имя БД, пользователь, пароль

### 3. Настрой переменные окружения

В настройках приложения добавь переменную:

```
DATABASE_URL=postgresql://USER:PASSWORD@HOST:PORT/DBNAME?sslmode=require
```

> Если SSL не используется: `postgresql://USER:PASSWORD@HOST:PORT/DBNAME`

### 4. Деплой

При каждом push в GitHub → Timeweb пересобирает образ → контейнер стартует и **автоматически применяет миграции** перед запуском сервера.

---

## Локальная разработка

```bash
# 1. Установить зависимости
npm install

# 2. Скопировать .env и заполнить DATABASE_URL (или оставить пустым — будет data/store.json)
cp .env.example .env

# 3. Применить миграции (если используешь локальный PostgreSQL)
npm run prisma:migrate

# 4. Запустить
npm run dev
# → http://localhost:3000
```

Без PostgreSQL приложение автоматически использует `data/store.json`.

---

## Как работает автомиграция

При старте контейнера выполняется `start.sh`:

```sh
if [ -n "$DATABASE_URL" ]; then
  npx prisma migrate deploy   # идемпотентно — уже применённые миграции пропускаются
fi
next start
```

Это безопасно при повторных деплоях — существующие данные не затрагиваются.

---

## Команды Prisma

| Команда | Описание |
|---|---|
| `npm run prisma:migrate` | Применить миграции (prod) |
| `npm run prisma:migrate:dev` | Создать и применить миграцию (dev) |
| `npm run prisma:studio` | GUI для просмотра/редактирования БД |
| `npm run prisma:generate` | Сгенерировать Prisma Client |

---

## Логин администратора

- **Логин**: `admin`  
- **Пароль**: `admin123`

> Смени пароль после первого входа в разделе настроек.
