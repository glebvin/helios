# Серверные проверки HELIOS

Все шесть jobs `.github/workflows/checks.yml` остаются обязательными. Режим `server` запускает их на одном repository-level runner `helios-ci`, зарегистрированном только для `glebvin/helios`. Они выполняются последовательно и отмечаются настоящими GitHub Checks на SHA текущего кандидата. Нового deploy из workflow нет.

Размещение — **только сервер HELIOS** (`progress-interface`); сервер Лампы не используется. Контур `/opt/helios-ci` не связан с `/opt/helios-staging`. Это отдельный Docker-контейнер без привилегий, host network, опубликованных портов, bind mounts, Docker socket, SSH-ключей и конфигурации стенда. UID10001, все capabilities сняты, `no-new-privileges`, CPU0.5, память896МБ без swap, shm128МБ, максимум512 процессов. OOM-приоритет800 и контроллер ресурса останавливают CI раньше рабочих приложений. При нехватке ресурса проверка не считается успешной.

Сеть `helios-ci`/`br-helios-ci`,172.30.50.0/24: исходящий интернет доступен для GitHub/npm; адреса хоста, частные сети, metadata и рабочие Docker-сети запрещены отдельными адресными правилами. Другие сети/правила и приложения не перенастраиваются. На хосте ничего не слушает54339; PostgreSQL живёт на loopback внутри CI-контейнера.

## Тестовые данные и зависимости

Перед job root-owned hook проверяет репозиторий и останавливает прежний тестовый кластер. После checkout отдельный шаг создаёт совершенно новый PG17 по точному пути `/opt/actions-runner/_work/helios/helios/codex-api/.data/pg-54339`; после job hook его останавливает. Создавать PGDATA до checkout нельзя: checkout очищает ignored-файлы. Проверки назначения в `prepare-ci-db.mjs` и существующих тестах сохраняются. Это настоящий GitHub runner: `GITHUB_ACTIONS` выставляет GitHub, а не локальный имитатор. Только test jobs применяют свои миграции/seed в эту одноразовую БД. Рабочие данные и файлы не монтируются.

Образ содержит Playwright1.62.1/Ubuntu24.04, runner2.338.2 и PG17.12.0; base digest и SHA256 архивов закреплены в Dockerfile. Node24 устанавливает прежний `setup-node`, Corepack0.35.0 и pnpm из lockfile сохранены. В server-режиме системные браузерные библиотеки уже находятся в образе, поэтому `playwright install` выполняется без `--with-deps`/sudo; сами браузерные и offline-тесты не сокращаются. GitHub-hosted режим сохраняет исходный сервис postgres:17 и установку зависимостей браузеров.

Для ограниченной памяти тесты освобождают завершённые браузерные контексты; два окна остаются одновременно открыты для проверки409. Независимый XLSX-декодер читает XML последовательно, сохраняя все проверки34 колонок/типов/стилей/формул. На реальном HTTP-файле10000 строк вывод старого и нового декодеров совпал побайтово; Python peak RSS снизился с299624 до127868КБ. Поздняя формула и повреждённый XML отклоняются обоими вариантами. Предел10000/отказ10001 и API-assertions не сокращались. Приватный протокол — `/opt/helios-ci/xlsx-reader-proof.json`.

GitHub-token администратора не сохраняется на сервере. Разовая регистрация использует короткоживущий registration token; runner получает обычный ограниченный токен каждого job (`contents: read`), checkout не сохраняет его в Git. Fork PR не запускается на этом runner; hook дополнительно проверяет исходный репозиторий. Логи/артефакты идут через прежние шаги GitHub; не увеличивать платные лимиты хранения автоматически.

19 ноября до регистрации выполнена отдельная проверка: реальные подключения к SSH хоста, рабочей PostgreSQL и metadata отклонены, GitHub доступен; UID/лимиты/отсутствие mounts/socket/портов подтверждены через Docker inspect. Hook отказал чужому репозиторию, затем создал и остановил свою PG17 с проверкой пользователя/порта/data_directory. Приватный протокол — `/opt/helios-ci/isolation.json`. Полный CI приложения и его SHA проверяются отдельно в живых Checks PR; preflight не заменяет эти шесть результатов.

## Настройка и управление

Сборка доверенного образа: `DOCKER_BUILDKIT=0 docker build --memory=768m --memory-swap=768m --cpu-quota=50000 -t helios-ci:runner-20261119 /opt/helios-ci`. Нельзя добавлять в build context исходники с `.env`, credential или данные стенда.

`bash /opt/helios-ci/install.sh` создаёт один контейнер `helios-ci-runner` из этого образа с перечисленными ограничениями; существующий контейнер скрипт не заменяет. Его запускает `helios-ci-runner.service`; `host-control.py prepare` проверяет ресурс и ставит адресные сетевые запреты до старта. `host-control.py run` прекращает CI при MemAvailable<160МБ или свободном диске<4ГБ. Для старта требуется>512МБ памяти и>5ГБ диска. Docker restart policy не используется: после перезагрузки порядок обеспечивает systemd.

После регистрации и проверки изоляции включить repository variables:

- `HELIOS_CI_MODE=server`
- `HELIOS_CI_RUNNER=["self-hosted","Linux","X64","helios-ci"]`

Обычный push/PR запускает те же шесть jobs автоматически; вручную — `gh workflow run checks.yml --repo glebvin/helios --ref <ветка>`. Перед merge проверять актуальный HEAD, все шесть Checks и совместимость с main. Старые прогоны, остановленные квотой GitHub-hosted, не становятся зелёными задним числом.

Остановить только CI: `systemctl stop helios-ci-runner`. Проверить: `systemctl status helios-ci-runner`, `docker stats --no-stream helios-ci-runner`, GitHub Settings → Actions → Runners. Отсутствие runner оставляет проверки в очереди, не разрешает merge.

Вернуть GitHub-hosted вычисления: удалить обе repository variables после восстановления квоты и повторить весь workflow нужного HEAD; серверный runner остановить. Это не откат приложения и не восстановление рабочей БД. Не удалять контейнер/его credentials, пока нужна регистрация; при замене сначала штатно удалить runner из GitHub и зарегистрировать новый.

При нынешнем GitHub Free/private защита ветки недоступна по API (403 Upgrade). Проверку шести зелёных Checks перед merge выполняет ответственный за доставку; технически принудительная branch protection не объявляется включённой.

[GitHub: стоимость self-hosted](https://docs.github.com/en/actions/concepts/billing-and-usage) · [Hooks](https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/run-scripts) · [Условный service image](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#jobsjob_idservicesservice_idimage)
