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
