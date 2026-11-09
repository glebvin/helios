# HELIOS — паспорт

Исходная копия: `/Users/Gleb/Helios`, ветка `main`.
Параллельные копии от одного коммита:

- Cursor, интерфейс: `/Users/Gleb/Documents/ChatGPT/sites/helios-worktrees/cursor-ui`, ветка `cursor-ui`
- Codex, API: `/Users/Gleb/Documents/ChatGPT/sites/helios-worktrees/codex-api`, ветка `codex-api`

`node_modules`, локальная база `.data` и файл `.env` в git не входят. В новой копии сначала установка.

## Запуск

Из корня выбранной копии:

```sh
corepack pnpm install
corepack pnpm db:up
corepack pnpm db:migrate
corepack pnpm db:seed
```

Три процесса:

```sh
corepack pnpm dev:api
corepack pnpm dev:worker
corepack pnpm dev:web
```

- API: http://127.0.0.1:4317
- Веб: http://127.0.0.1:5173, прокси `/api` идёт на API
- Postgres: `127.0.0.1:54329`, данные в `.data/pg` только этой копии

Порты 54329, 4317 и 5173 одни на машину. Вторую копию одновременно не поднимать.

## Проверка

```sh
corepack pnpm test
curl -s http://127.0.0.1:4317/api/health
```

`pnpm test` гоняет правила домена и `apps/api/test/foundation.test.ts`. Для API-теста нужен уже запущенный Postgres. Health отвечает `{"ok":true}`.

Учебный вход после seed: `director@pilot.helios` / `pilot-director`. Веб: http://127.0.0.1:5173.

## Параллельный backend — codex-api

Из корня backend-копии (исходный запуск UI выше сохранён):

```sh
corepack pnpm install --frozen-lockfile
export HELIOS_DB_PORT=54339
export DATABASE_URL=postgres://helios_app:helios_app@127.0.0.1:54339/helios
export ADMIN_DATABASE_URL=postgres://helios:helios@127.0.0.1:54339/helios
export API_PORT=4327
corepack pnpm db:up
```

`db:up` держит процесс открытым. Остальные команды выполняйте в другом терминале с теми же переменными (повторите четыре `export`). PostgreSQL использует `.data/pg-54339` только этой копии; скрипт проверяет data_directory уже запущенного слушателя. По умолчанию остаются 54329 и `.data/pg`. Не направляйте backend-тесты/seed в базу UI. Если sandbox запрещает shared memory/listen, запуск PostgreSQL и HTTP-тестов требует разрешённого host execution.

```sh
corepack pnpm db:migrate
corepack pnpm db:migrate
corepack pnpm db:seed
corepack pnpm test
corepack pnpm --filter @helios/api exec tsx --test test/director-api.test.ts
corepack pnpm --filter @helios/api exec tsc --noEmit
corepack pnpm dev:api
```

Backend: http://127.0.0.1:4327/api/health. Контракт: http://127.0.0.1:4327/api/v1/openapi.json и `apps/api/openapi.json`; подробности в `docs/director-api.md`. `pnpm test` теперь запускает domain, foundation и v1 HTTP/PG suites. Foundation требует seed; новые fixtures независимы и удаляют только себя. Повторные миграции используют ledger и advisory lock; application role не имеет прав на ledger.

Не запускайте `dev:web` в backend-копии. Подключение параллельной UI-копии к 4327 через proxy/CORS — отдельный согласованный шаг; frontend здесь не менялся. Этот срез даёт чтение и доступ, а не готовность всего пилота/телефонного offline/production нагрузки.
