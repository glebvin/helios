# Разработка и проверки

## Требования

Node.js 24, Corepack 0.35.0, pnpm из packageManager (12.18.0). Зависимости ставятся по pnpm-lock.yaml. PostgreSQL должен быть отдельным для разработки/QA. Адреса и пароли активного стенда здесь не публикуются.

```sh
corepack pnpm install --frozen-lockfile
python3 scripts/check-docs.py
node scripts/check-types.mjs
corepack pnpm --config.verifyDepsBeforeRun=false --filter @helios/web build
corepack pnpm --config.verifyDepsBeforeRun=false --filter @helios/domain test
```

Пакет domain пока использует явный typeRoots к установленным типам API; это известное ограничение структуры зависимостей, отражённое в scripts/check-types.mjs. Не исправлять соседние зависимости вместе с UI-задачей без причины.

## Локальные сервисы

`scripts/db.mjs` запускает embedded PostgreSQL в .data, по умолчанию порт 54329; HELIOS_DB_PORT позволяет отдельный контур. Скрипт проверяет каталог занятого порта. Не запускать его как способ заменить существующую базу.

API использует ADMIN_DATABASE_URL для миграций и DATABASE_URL для ограниченного приложения. Переменные задать только для своего отдельного контура. Перед migrate/seed проверить host, port, database и отсутствие активных пользовательских данных. Дефолтный seed создаёт учебные учётки, а не текущие 13 кабинетов.

`corepack pnpm dev:api` — API; `corepack pnpm dev:web` — Vite; `corepack pnpm dev:worker` — фоновые задания. API_PORT задаёт API, HELIOS_API_ORIGIN задаёт proxy Vite, HELIOS_WEB_PORT — порт интерфейса. По умолчанию Vite ожидает API на 4341, интерфейс 5184. Адреса согласовать между процессами, не менять общий конфиг ради одного локального запуска.

## Серверные тесты

`corepack pnpm --config.verifyDepsBeforeRun=false --filter @helios/api test` пишет синтетические данные и проверяет миграции. Нужны применённые миграции, базовая учебная фикстура, ограниченная роль helios_app с RLS. Несколько исторических тестов повторной миграции жёстко используют 127.0.0.1:54339/helios, поэтому не запускать полный набор против произвольного или занятого контура.

GitHub Actions создаёт одноразовый PostgreSQL 17 на этом порту и отдельную роль, затем migrate, seed и последовательные тесты. Пароли в workflow относятся только к одноразовой службе runner и не дают доступа к стенду. Нет server/SSH secrets и автоматической выкладки.

## Что покрывает CI

- Ссылки входных документов и зависимости 27 карточек.
- TypeScript API/web/domain/offline.
- Production Vite build и domain-тесты.
- Серверные API-тесты в изолированной БД.

CI не покрывает внешний вид, весь сквозной UI, физические телефоны и полноценный офлайн. Локальные и браузерные проверки шага остаются обязательными.

## Offline-модуль

Существующие browser-тесты требуют Playwright ровно 1.62.1, HELIOS_PLAYWRIGHT_MODULE и PLAYWRIGHT_BROWSERS_PATH; подробности в [offline-queue](offline-queue.md). Они не добавлены в базовый CI с молчаливым пропуском. Их подключение и UI/PWA проверка — R23–R26. Не объявлять офлайн готовым по зелёному базовому CI.


В локальных копиях с уже установленными/связанными node_modules используйте --config.verifyDepsBeforeRun=false: иначе pnpm может попытаться автоматически переустановить зависимости до запуска команды. Это не замена install --frozen-lockfile в чистом CI.
