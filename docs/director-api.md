# HELIOS API v1 — handoff интерфейсу

Срезы **02a: люди → квалификации → допуск → назначение → бригада** и **02b: каталоги → план → готовность фронта → согласование → публикация** сохраняют первый API чтения. Контракт `apps/api/openapi.json` доступен через `GET /api/v1/openapi.json`: **69 операций — 68 v1 и один retired legacy-create endpoint: прежние58 сохранены, добавлены6 операций файлов и5 операций утверждения времени/Excel**. Защищённые v1-маршруты требуют действующей сессии и активного членства в кабинете. Это ещё не готовый пилот.

## Вход и кабинет

```sh
curl http://127.0.0.1:4327/api/v1/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"director@pilot.helios","password":"pilot-director"}'
```

Успех входа — HTTP 201: `{token, user: {id,email,name}, memberships: [{tenant_id,role,status}]}`. Выбирайте кабинет из `memberships`; не придумывайте `tenantId` или роль. Пустой список означает отсутствие активного доступа. Учебные логин/пароль существуют только после локального seed. `/api/auth/login` сохраняет тот же успешный контракт. Неверное тело — 400, неверные учётные данные — 401.

Для всех защищённых запросов передавайте `Authorization: Bearer <token>` (64 hex-символа) и `x-tenant-id: <UUID>`. `GET /api/v1/me` возвращает `{userId,tenantId,role,name,email}`. `POST /api/v1/auth/logout` с теми же заголовками удаляет только предъявленную сессию, возвращает HTTP 201 `{ok:true}`. Другие сессии пользователя продолжают работать. Для выхода из кабинета с уже отозванным членством достаточно удалить локальный токен; защищённый logout в этом случае возвращает 403.

Срок сессии — 12 часов, refresh ещё не реализован. Парольные хеши, session id и хеши токенов в ответах отсутствуют.

## Доступ

Director видит проекты и людей своего кабинета. Master и PTO видят проекты с явным активным `project_memberships` и людей, активно назначенных на эти проекты. Доступ к проектам не выводится из задач. Worker дополнительно должен иметь собственную запись сотрудника с активным назначением на проект; видит только задачи, назначенные на такую собственную запись. Саму собственную карточку сотрудника можно читать и без назначения. Неназначенные люди видны директору и самим себе.

Каждый запрос заново проверяет сессию и членство. Списки скрывают недоступные записи, detail и явный недоступный `projectId` возвращают 404. Неактивное членство кабинета — 403, отсутствующая/истёкшая/отозванная сессия — 401. Некорректный UUID, дата или query — 400. Роли из заголовков/тела не принимаются как полномочия. Текущая UI должна обрабатывать эти статусы отдельно.

## Чтение

Все списки возвращают `{items,total,limit,offset}`. Пагинация: `limit` 1–100 (по умолчанию 25), `offset` целое ≥0 (по умолчанию 0). `total` — все видимые записи до пагинации. Сортировка стабильная: проекты по имени/id, люди по имени/id, задачи по дате DESC/названию/id. Повторные, массивные и неизвестные query-параметры отклоняются.

| Запрос | Поля items / объекта |
|---|---|
| `GET /api/v1/projects` | `id,name` |
| `GET /api/v1/projects/:id` | `id,name` |
| `GET /api/v1/projects/:id/tasks?day=2026-11-01` | `id,projectId,title,workDate,plannedQuantity,unit,assigneeEmployeeId,status,version` |
| `GET /api/v1/employees?projectId=<UUID>` | `id,fullName,phone,organizationId,userId,version,status` |
| `GET /api/v1/employees/:id` | те же поля сотрудника |

У employees `projectId` необязателен; при его наличии нужна видимость проекта. Телефон и userId могут быть null; паспортного/документного номера в v1 нет. Количество передаётся десятичной **строкой**, не JS number. `status` задачи — её сохранённый статус; приёмка отчёта не делает задачу автоматически завершённой. Без `day` список задач возвращает все даты; `day` должен быть реальной календарной датой YYYY-MM-DD. ID относятся к выбранному кабинету; не используйте глобальную догадку о проекте.

```sh
curl http://127.0.0.1:4327/api/v1/projects \
  -H "authorization: Bearer $TOKEN" -H "x-tenant-id: $TENANT_ID"
curl "http://127.0.0.1:4327/api/v1/projects/$PROJECT_ID/tasks?limit=25&day=2026-11-01" \
  -H "authorization: Bearer $TOKEN" -H "x-tenant-id: $TENANT_ID"
curl "http://127.0.0.1:4327/api/v1/overview?projectId=$PROJECT_ID&day=2026-11-01" \
  -H "authorization: Bearer $TOKEN" -H "x-tenant-id: $TENANT_ID"
```

## Сводка

`GET /api/v1/overview?projectId=<UUID>&day=YYYY-MM-DD`. Оба параметра необязательны: без проекта учитываются все разрешённые проекты, без дня — текущая гражданская дата в сохранённой timezone кабинета. Ответ всегда содержит применённые `day`, `timezone`, `projectId` (null без фильтра).

| Поле | Смысл |
|---|---|
| `assignedEmployees` | Уникальные видимые активно назначенные сотрудники, включая людей без задач; текущее состояние назначений |
| `tasksForDay` | Видимые задачи с work_date выбранного дня |
| `employeesStartedShiftsForDay` | Уникальные видимые сотрудники, начавшие смены в этот день |
| `currentOpenShifts` | Все открытые видимые смены **сейчас**, независимо от выбранного дня |
| `submittedReportsForDay` | Отчёты, созданные в выбранный день |
| `reviewedReportsForDay` | Отчёты того же дня с accepted_quantity не null, включая приёмку 0 |
| `quantities` | Массив `{unit,submittedQuantity,acceptedQuantity}` по единице; десятичные строки, acceptedQuantity null, если в группе нет рассмотренных отчётов |
| `quality`, `downtimeDuration`, `idReadiness` | `{status:"unavailable",value:null,source:<причина>}` |

Для дат timestamp используются полуоткрытые границы `[полночь, следующая полночь)` в timezone кабинета, включая переходы DST. `shiftStartSource` документирует `occurred_started_at` с fallback на `started_at`; `reportDateSource` — `work_reports.created_at`. Дата задачи, начало смены и дата создания отчёта независимы. Одна задача с несколькими отчётами не умножает количество задач/людей/смен. Пустой набор даёт ноль (или пустой массив), отсутствующий бизнес-модуль — null/unavailable. Приёмка 0 означает рассмотренный отчёт, не успешное выполнение задачи. Единицы м²/м³/шт не суммируются в одно число.

## Границы и подключение UI

В v1 нет демонстрационных процентов/колец. Старый `/api/summary` остаётся явно учебным (`sample:true`), его нельзя выдавать за боевую сводку. Seed не выдаёт master/PTO/worker доступ ко всем проектам: директор управляет явными членствами через новый endpoint ниже. Назначения из существующих задач мигрировались один раз при 002; последующие legacy-записи не синхронизируют их автоматически. Прежние назначения сохранены с `admissionCheckId:null`, `currentAdmission.eligible:false` и причиной `no_check`; миграция не выдумывает успешный допуск.

02a реализует квалификации, первый допуск yes/no и бригады;02b — подготовку одноперсонных задач, готовность фронта и атомарную публикацию;03a — смены, интервалы работы/перерывов/простоев и предварительный объём;03b-server — приватные вложения, утверждение часов и XLSX. Нет полного цикла typed/photo/measurement чек-листов качества и замечаний,14 маршрутов и реестра полномочий, входящих материалов, ИД/АОСР/hold points, MFA и операционной приёмки. Долговечная браузерная очередь, подключение UI и проверка offline на физических телефонах остаются03c. HTTP/PG-тесты сервера не подтверждают эти клиентские сценарии.

Legacy `POST /api/tasks` возвращает **410 task_creation_retired** для любого авторизованного участника; прямой вызов сервиса также закрыт. Замена: `POST /api/v1/projects/:id/tasks`, затем front-checks/submit/publish. Managed02b задачи во всех состояниях отклоняют legacy shift_start, shift_end, submit_volume и приёмку отчёта с **409 workflow_not_supported** до event receipt/replay и эффектов. Отсутствующий/чужой task —404. Worker не получает право приёмки. Новых смен/отчётов/job/event/audit при отказе нет. Старые явно legacy строки сохраняют ограниченную совместимость для foundation fixture, без сертификации текущего допуска/offline/проектных прав. Managed lineage неизменяем; публикация не открывает legacy выполнение. Touched legacy desk/summary скрывают worker чужие/preparation task/shift/report IDs и counts; полный аудит прочих старых маршрутов остаётся отдельной работой.

Backend API запускается на 4327, исходный UI использует 4317. Proxy/CORS для параллельной UI-копии — согласованный следующий шаг; `apps/web` этим срезом не меняется. Существующий CORS разрешает 5173 на localhost/127.0.0.1. OpenAPI servers указывает локальный backend4327.

## Проверка

Из codex-api после начальных db:up/migrate/seed, только с изолированным PG54339 и явным окружением. Перед migrate/test проверьте port54339 и data_directory `codex-api/.data/pg-54339`. API4327 перезапускает родительский агент после независимой проверки источников.

```sh
export DATABASE_URL=postgres://helios_app:helios_app@127.0.0.1:54339/helios
export ADMIN_DATABASE_URL=postgres://helios:helios@127.0.0.1:54339/helios
export HELIOS_DB_PORT=54339 API_PORT=4327
corepack pnpm test
corepack pnpm --filter @helios/api exec tsx --test test/director-api.test.ts
corepack pnpm --filter @helios/api exec tsx --test test/people-api.test.ts
corepack pnpm --filter @helios/api exec tsc --noEmit
```

Новая suite создаёт уникальные кабинеты/людей/проекты, проверяет настоящий HTTP и PostgreSQL под ограниченной ролью, удаляет только свои fixtures. Для setup/teardown нужен ADMIN_DATABASE_URL; обычные API-запросы используют DATABASE_URL. Миграции внутри suite запускаются повторно с проверкой сохранности данных/ledger. Foundation suite отдельно использует демонстрационные данные seed и добавляет свои события/задачи; запускать её только на локальной тестовой базе. API suites выполняются последовательно. Административная роль нужна только мигратору, seed и тестовым fixture-операциям, API работает ограниченной ролью.

## Команды людей 02a

Все новые POST/PUT доступны только активному **director**. Никаких invitations, создания логина или изменения роли здесь нет. `userId` необязателен при создании и ссылается только на уже существующего активного участника этого кабинета; `organizationId` тоже принадлежит кабинету. Поля документа сотрудника не выдаются.

Каждая команда содержит UUID `requestId`. Повтор того же actor/tenant/requestId с тем же методом, путём и нормализованным полным телом возвращает исходный ответ и HTTP-статус, даже если после команды состояние изменилось. Текущие права проверяются перед каждым replay. Изменение операции/данных с прежним ключом — 409 `idempotency_payload_mismatch`. Резервация receipt, бизнес-запись и audit выполняются одной транзакцией; неудачная команда не сохраняет ни один из этих эффектов.

Изменения требуют `expectedVersion` текущего объекта. Конфликт — 409 `stale_version`. Только PUT membership/assignment/crew-member принимает `expectedVersion:0`: создать при отсутствии строки; если строка существует, включая revoked, нужен её текущий version. Успешный POST — 201, PUT — 200. Строки trim, имена/title ≤200, code/itemId ≤80, labels/documentReference/phone ≤500, массивы ≤100. Неизвестные поля/query, неверные UUID/date/boolean/version, повторы IDs/кодов/ответов — 400. Скрытая ссылка — 404, запрещённая ссылка/архив — 422 `reference_denied`, недействующий допуск — 422 `admission_required`.

| Операция, без `/api/v1` | Тело помимо requestId / результат |
|---|---|
| `POST /employees` | `{fullName,organizationId,phone?,userId?}` → E |
| `PUT /employees/:e` | `{expectedVersion,fullName,organizationId,phone,userId,status}` → E; phone/userId nullable, status active/archived, полная замена |
| `GET/POST /employees/:e/qualifications` | GET paged Q; POST `{code,title,documentReference?,validUntil?}` → Q |
| `PUT /employees/:e/qualifications/:q` | `{expectedVersion,title,documentReference,validUntil,status}` → Q; nullable metadata/date; active/revoked |
| `GET/POST/PUT /projects/:p/admission-template` | GET latest T; POST `{code,title,items,requiredQualificationCodes}`; PUT `{expectedVersion,title,items,requiredQualificationCodes}` → T |
| `GET /projects/:p/admission-template/versions` | paged T, version DESC |
| `GET/POST /employees/:e/admission-checks` | GET paged C, optional projectId; POST `{projectId,templateVersion,answers}` → C |
| `GET /employees/:e/admission-checks/:check` | immutable C; нужна видимость сотрудника **и** проекта проверки |
| `GET /projects/:p/memberships`; `PUT /projects/:p/memberships/:user` | PUT `{expectedVersion,status}` → `{projectId,userId,role,status,version}`; GET paged, только director |
| `GET /projects/:p/assignments`; `PUT /projects/:p/assignments/:e` | PUT `{expectedVersion,status,admissionCheckId?}` → A; GET paged |
| `GET/POST /projects/:p/crews` | GET paged crews с видимыми members; POST `{name}` → `{id,projectId,name,version}` |
| `GET /projects/:p/crews/:crew` | `{id,projectId,name,version,members:[M]}` |
| `PUT /projects/:p/crews/:crew/members/:e` | `{expectedVersion,status}` → M |

E = прежний Employee + version/status. Q = `{id,employeeId,code,title,documentReference,validUntil,status,version}`. `documentReference` — только текстовая метадата, без S3/файла/загрузки. Code неизменяем; revoked терминален. Даже expired active занимает уникальный code: сначала revoke, затем новый Q. Любое изменение Q повышает version.

T = `{projectId,code,title,version,items:[{id,label,critical}],requiredQualificationCodes}`. На проект одна семья с неизменяемым code: выбрать более слабую альтернативу нельзя. PUT публикует новую неизменяемую версию. Только boolean yes/no; минимум один item, IDs и required codes уникальны. Каждый ответ `{itemId,value:boolean}` требуется ровно один раз. Чужие/неполные/повторные ответы — 400; устаревшая templateVersion — 409 `template_changed`.

C сохраняет `{id,employeeId,projectId,templateCode,templateVersion,sequence,answers,templateSnapshot,qualificationEvidence,checkedBy,checkedAt,civilDate,passed,reasons,warnings}`. Evidence содержит точные `{id,code,version,validUntil,status}`. passed и actor/time/evidence вычисляет сервер. Critical false, отсутствие/истечение требуемой квалификации сохраняют **failed-проверку**, а не отклоняют её HTTP-запись. Noncritical false даёт warning. Последовательность выделяется под блокировкой сотрудника; время не определяет latest.

A = `{projectId,employeeId,status,version,admissionCheckId,currentAdmission}`. M = `{employeeId,status,version,currentAdmission}`. currentAdmission = `{eligible,reasons,checkId,templateVersion}` вычисляется при чтении и в той же транзакции активации. Нужны активный человек, passed-проверка именно этого employee/project, последняя попытка (включая failed), последняя версия шаблона и **ровно те же id+version** всех требуемых активных Q. validUntil включительно по гражданской дате timezone кабинета; null без срока. Замена, правка или revoke требуемого Q требует новой проверки; unrelated Q не влияет. Исторический passed никогда не переписывается при инвалидировании.

Для active assignment admissionCheckId обязателен при каждой команде, даже обновлении active или реактивации; revoked не принимает его и сохраняет прежнюю lineage. Связанный worker должен иметь активное tenant membership: assignment атомарно создаёт/реактивирует его project membership, повышая version только при изменении. Для director/master/PTO автоматического project membership нет. Явный endpoint возвращает role из tenant membership и не меняет tenant role. Revoke assignment отзывает активные crew members, сохраняя project membership. Crew inclusion требует active assignment/current admission; одна active crew на employee/project (409 `crew_conflict`). Перемещение — revoke, затем activate. Crew другого проекта — 404.

Archive сотрудника терминален: атомарно отзывает active assignments и crew members, повышает их versions и пишет audit до/после/requestId для каждого эффекта. Unarchive отсутствует. История сохраняется; master/PTO/worker после revoke могут потерять проектную видимость, director сохраняет доступ своего кабинета. Worker читает только свои данные/участия; membership administration доступна только директору.

## Пример последовательности для UI

Каждый ниже JSON — отдельный запрос с новым UUID `requestId`; `${...}` обозначает ID из предыдущего ответа. Те же auth/tenant headers обязательны. Результаты и номера versions берите из ответов, не из примера.

```json
POST /employees
{"requestId":"${r1}","fullName":"Иван Петров","organizationId":"${org}","userId":"${existingWorkerUser}"}
POST /employees/${employee}/qualifications
{"requestId":"${r2}","code":"safety","title":"Инструктаж","documentReference":"Журнал №12","validUntil":"2027-11-09"}
POST /projects/${project}/admission-template
{"requestId":"${r3}","code":"project-entry","title":"Допуск","items":[{"id":"briefed","label":"Инструктаж проведён","critical":true}],"requiredQualificationCodes":["safety"]}
POST /employees/${employee}/admission-checks
{"requestId":"${r4}","projectId":"${project}","templateVersion":1,"answers":[{"itemId":"briefed","value":true}]}
PUT /projects/${project}/assignments/${employee}
{"requestId":"${r5}","expectedVersion":0,"status":"active","admissionCheckId":"${check}"}
POST /projects/${project}/crews
{"requestId":"${r6}","name":"Бригада №1"}
PUT /projects/${project}/crews/${crew}/members/${employee}
{"requestId":"${r7}","expectedVersion":0,"status":"active"}
PUT /projects/${project}/memberships/${existingMasterUser}
{"requestId":"${r8}","expectedVersion":0,"status":"active"}
```

Теперь worker видит назначенный проект; директор видит currentAdmission в GET assignments/crews. Для обновления сотрудника отправьте все поля с nullable phone/userId и текущим expectedVersion. Для отзыва Q используйте его PUT/status revoked; для новой версии T — PUT без code. Для отзыва назначения/участия отправьте PUT `{requestId,expectedVersion,status:"revoked"}`. При следующей failed-проверке старый passed ID уже не даёт активировать assignment. UI может показать исторический passed рядом с `currentAdmission.eligible:false`; это разные факты.

Сервер блокирует project → employee → tenant membership → assignment → project membership → crew member (receipt перед ними); каждая группа упорядочена по ключу. NO KEY UPDATE совместима с неявными FK KEY SHARE, исключая обратные повышения блокировок при вставке дочерних строк. HTTP/PG suite проверяет реальные очереди конкурирующих link/archive/qualification/template и implicit/explicit grant, а не обещает нагрузочную/production готовность.

## Задачи02b: доступ и каталоги

| Возможность | Director | Master с активным project membership | PTO с активным project membership | Worker |
|---|---|---|---|---|
| Каталоги и front-template, версии | чтение/изменение | чтение | чтение | нет |
| Draft/pending/cancelled планы, front history/readiness | чтение/подготовка | чтение/подготовка | чтение | скрыты |
| Submit/reopen | да | да | нет | нет |
| Reject/publish | да | нет | нет | нет |
| Cancel draft/pending | да | да | нет | нет |
| Cancel published | да | нет | нет | нет |
| Published managed task | чтение | чтение | чтение | только собственная с активным employee assignment и project membership |

Все пути ниже имеют префикс `/api/v1`. Коллекции используют прежние `{items,total,limit,offset}`; неизвестные query/body поля, повторные query, массивы вместо скаляров, поддельные passed/status/snapshot/actor/time отвергаются400. Идентификаторы tenant/project проверяются сервером, UUID нормализуются в lowercase. Каждая мутация требует requestId, правка существующей записи/действие — expectedVersion. POST создания/попытки —201, PUT и POST lifecycle —200, включая replay.

| Путь | Форма помимо requestId |
|---|---|
| `GET/POST /projects/:p/zones`; `PUT /projects/:p/zones/:z` | POST `{name}`, PUT `{expectedVersion,name,status:active\|archived}` |
| `GET/POST /projects/:p/work-types`; `PUT /projects/:p/work-types/:w` | `{name,unit,requiresRd,requiresMaterialControl,requiresPredecessorAcceptance,requiresId}`, PUT добавляет expectedVersion/status |
| `GET /projects/:p/tasks` | `day` или `workDate` (вместе400), status из известных legacy/managed состояний, limit/offset |
| `GET /projects/:p/tasks/:t` | прежние camelCase поля + workflowKind, planRevision, zoneId, workTypeId, responsibleUserId, rdReference, plannedStart/End, publicationSnapshotId |
| `POST /projects/:p/tasks`; `PUT /projects/:p/tasks/:t` | полная плановая форма ниже; PUT добавляет expectedVersion, только draft |
| `POST /projects/:p/tasks/:t/submit` | `{expectedVersion}`: draft → pending_approval; структура обязательна, readiness может быть неполной |
| `POST .../:t/reject`, `POST .../:t/reopen` | `{expectedVersion,reason}`: pending_approval → draft; reject только director |
| `POST .../:t/cancel` | `{expectedVersion,reason}`: терминальный cancelled; сохранённые plan/evidence не удаляются |
| `POST .../:t/publish` | `{expectedVersion}`: pending_approval → published, полный атомарный recheck |
| `GET/POST/PUT /projects/:p/front-template`; `GET .../versions` | POST `{code,title,items:[{id,label,critical}]}`, PUT `{expectedVersion,title,items}`; stable code, неизменяемые версии |
| `GET/POST /projects/:p/tasks/:t/front-checks`; `GET .../:check` | POST `{expectedVersion,templateVersion,answers:[{itemId,value:boolean}]}` |
| `GET /projects/:p/tasks/:t/readiness` | `{ready,reasons,warnings}`, информационное текущее вычисление для director/master/PTO |

Zone/WorkType возвращают id/projectId/name/version/status, WorkType также unit и четыре requirement flags. Это настоящие каталоги проекта с составными tenant/project FK. Архив или новая версия каталога инвалидируют readiness; нормативов/стоимостей/эффективности нет.

План: `{zoneId,workTypeId,title,workDate,plannedQuantity,assigneeEmployeeId,responsibleUserId,plannedStart,plannedEnd,rdReference}`. Один сотрудник на задачу. Unit выводится из текущего work type, не принимается от клиента. Ответственный — активный same-tenant director или master, назначенный на проект. Draft допускает ещё не связанного с user сотрудника; публикация требует связь и активные членства. Наличие человека в бригаде не означает несколько исполнителей задачи.

Quantity — строго положительная JSON **строка** до11 целых цифр и3 дробных для numeric(14,3). Сервер не округляет и не использует Number/parseFloat: `"0012.340" → "12.340"`, `"0.000"`, numeric12, exponent/sign/NaN/infinity/переполнение/лишняя точность —400. WorkDate — реальная дата0001…9999. Интервалы — реальные RFC3339 instants с явным Z или offset и точностью не выше миллисекунд; запрещены отсутствующий offset, неправильная календарная дата/время/offset и лишние дробные секунды. Start<end; обе даты после перевода в действительную сохранённую timezone tenant должны совпадать с workDate. Нет fallback на Moscow. Переход через tenant-civil полночь отклоняется. RD — bounded nonblank текстовая метадата или null; при requiresRd=true обязателен. Это не проверка наличия файла/реестра РД.

## Готовность фронта и публикация

Одна семья front-template на проект,1…100 уникальных yes/no items. Director PUT публикует новую неизменяемую версию. Полные ответы принимаются только для draft/pending, ID каждого item ровно один раз, никаких дополнительных/пропущенных/повторных. Critical false сохраняет failed attempt; noncritical false сохраняет warning. Последняя попытка определяется sequence, включая failed. Сохранённый FrontCheck включает id/sequence/taskId/projectId/planRevision/templateCode/templateVersion/templateSnapshot/zoneVersion/workTypeVersion/answers/passed/reasons/warnings/checkedBy/checkedAt. Server вычисляет passed и время/автора. Запись попытки повышает task.version, плановая правка — version и planRevision; старый front после правки плана больше не подходит.

Публикация требует активный assignment и его точный текущий admissionCheckId; применяется **тот же PeopleService evaluator на том же PoolClient**, включая latest attempt/template и точные активные qualification id/version. ValidUntil включительно сравнивается и с сегодняшней tenant-civil датой, и с task.workDate: действующий сегодня документ с истечением до будущего workDate блокирует задачу. Нельзя обойти failed/новую проверку старым passed ID. Актуальны linked employee user, tenant membership, для linked worker project membership, полномочия ответственного и его project link, активные каталоги/совпадающий unit, последняя passed front attempt и её plan/template/catalog bindings.

RequiresMaterialControl даёт `material_not_accepted`, пока для партии, зоны и вида нет принятого входного контроля. requiresPredecessorAcceptance / requiresId дают `predecessor_acceptance_unsupported` / `id_unsupported`. Ответы фронта yes не заменяют отсутствующие записи предшественников/ИД. Это ограниченная готовность02b, полное TZ6.2 не принято. RD отсутствие даёт `rd_required`.

Другие readiness reasons: `front_missing`, `front_failed`, `front_template_changed`, `front_plan_changed`, `front_catalog_changed`, `assignment_inactive`, `employee_archived`, `employee_unlinked`, `employee_member_inactive`, `employee_project_inactive`, `responsible_inactive`, `zone_inactive`, `work_type_inactive`, `work_type_unit_changed`, `invalid_tenant_timezone`, `invalid_interval`, `admission:<причина02a>`, `qualification_expired_on_work_date:<code>`. Публикация unready —422 `task_not_ready`, stale expectedVersion —409 `stale_version`, устаревший front template —409 `template_changed`; смотрите отдельное GET readiness для причин. Ошибки сохраняют общий `{error:string}` envelope, failed-команда не оставляет receipt/audit/snapshot/business эффектов и может быть повторена с тем же requestId после устранения причины.

Для одного employee проверяются **все tenant проекты**: интервалы `[start,end)` конфликтуют при newStart<existingEnd и newEnd>existingStart с уже published managed задачами; точное соседство допустимо, конфликт409 `assignment_overlap`. Cancelled снимает занятость, сохраняя доказательства. Legacy строки без интервалов не объявлены проверенными на пересечение.

Публикация атомарно сохраняет task_publication_snapshots: полный опубликованный план (старые и новые поля, exact quantity, revision), timezone, employee/link/member/assignment, admission/check/qualification evidence, front/template/catalog versions, responsible/current actor и время. В ответе Task+publicationSnapshotId+`readiness:{ready:true,reasons:[],warnings}`. Snapshot хранится в БД и описан в OpenAPI `TaskPublicationSnapshot`; отдельного public export/read endpoint для него нет. Истории имеют FORCE RLS и SELECT/INSERT-only app grants; UPDATE/DELETE запрещены. План/lineage/snapshot reference после публикации защищены триггером. Каталоги и документы могут изменяться без переписывания истории; published plan не редактируется/не reopen. Только director cancellation меняет status/version с audit, сохраняя plan/snapshot.

Порядок task-команд: shared receipt reservation → target project NO KEY UPDATE → сортированные old/new employee IDs → свежие employee links → сортированные tenant memberships и project memberships → task/assignments. Hint task до employee lock не является полномочием; после ожиданий отдельные READ COMMITTED SELECT заново проверяют version/assignee/responsible и текущий ACL. Изменившийся hint прекращает команду409 без позднего обратного захвата employee lock. Overlap читает другие проекты без их project/task locks: employee lock сериализует публикацию между проектами. NO KEY UPDATE совместим с FK KEY SHARE. Поддерживаемые personnel/catalog/front/membership изменения используют совместимый порядок; archive не берёт project locks.

Replay имеет отдельную ветку: project → актуальные actor tenant/project memberships → исходный receipt body/status. Эта ветка не берёт employee/task/assignment locks и не оценивает повторно expectedVersion/front/admission/catalog. RequestId namespace общий с02a; тот же UUID в другой people/task операции или с другим payload даёт409. Обычные GET под READ COMMITTED информационны: totals/items/readiness в нескольких SQL не являются согласованным межзапросным snapshot и могут измениться между чтением и командой. Только publish даёт атомарное решение.

## Пример ежедневной задачи

Предполагаются готовые02a employee/admission/active assignment, связанные user и master/project membership. Отдельные requestId и текущие versions берите из ответов. Префикс `/api/v1`, auth/tenant headers как выше.

```json
POST /projects/${project}/zones
{"requestId":"${r1}","name":"Этаж 2"}
POST /projects/${project}/work-types
{"requestId":"${r2}","name":"Бетонирование","unit":"м3","requiresRd":true,"requiresMaterialControl":false,"requiresPredecessorAcceptance":false,"requiresId":false}
POST /projects/${project}/front-template
{"requestId":"${r3}","code":"front","title":"Готовность фронта","items":[{"id":"access","label":"Доступ подготовлен","critical":true}]}
POST /projects/${project}/tasks
{"requestId":"${r4}","zoneId":"${zone}","workTypeId":"${workType}","title":"Плита этажа 2","workDate":"2027-01-15","plannedQuantity":"12.340","assigneeEmployeeId":"${employee}","responsibleUserId":"${master}","plannedStart":"2027-01-15T09:00:00+03:00","plannedEnd":"2027-01-15T10:00:00+03:00","rdReference":"РД-24"}
POST /projects/${project}/tasks/${task}/front-checks
{"requestId":"${r5}","expectedVersion":1,"templateVersion":1,"answers":[{"itemId":"access","value":true}]}
POST /projects/${project}/tasks/${task}/submit
{"requestId":"${r6}","expectedVersion":2}
POST /projects/${project}/tasks/${task}/publish
{"requestId":"${r7}","expectedVersion":3}
```

Последний запрос выполняет директор. Worker теперь видит только собственную published задачу, включая v1 overview и touched legacy counts. Legacy смена/отчёт по managed задаче закрыты409; новый серверный execution03a описан ниже. Достоверный browser offline, quality inspections, authority routes, реальный material/ID/AOSR/hold-point процесс, multiple executors, нормы, MFA/backup/load и полная приёмка пилота остаются впереди. Серверный поток вложений добавлен в03b ниже. Эти возможности не заменяются front yes/no или тестовыми legacy отчётами.

В текущем install layout отдельная команда domain `tsc --noEmit` не находит types/node (TS2688), хотя API typecheck и domain runtime tests проходят. Без установки/изменения зависимостей подтверждён вариант с уже установленными типами: `corepack pnpm --filter @helios/domain exec tsc --noEmit --typeRoots ../../apps/api/node_modules/@types`. Это ограничение локального resolution, не утверждение о прохождении исходной команды.

## Управляемое выполнение03a

На checkpoint03a контракт вырос с53 до58 операций: добавлены POST `/api/v1/execution/events` и четыре GET ниже. Legacy `/api/shifts/*` и `/api/work-reports` по-прежнему отвергают managed задачи409, legacy create410. Новые данные находятся только в managed таблицах; published/cancelled план и publication snapshot не меняются. Исполнение не означает приёмку.

POST body строго `{events:[...]}`,1–50 уникальных UUID requestId. Весь синтаксис проверяется до записи: неизвестное поле, невалидный instant/UUID/quantity или повтор requestId даёт400 без эффектов всего batch. Затем каждый item — отдельная транзакция в исходном порядке. HTTP200 `{results:[{requestId,outcome:"success"|"duplicate",status:201,result}|{requestId,outcome:"error",status,code,retryable}]}`. Неудача не отменяет уже успешные независимые items и не расходует version/receipt. RequestId одновременно идентификатор события; отдельного eventId нет.

Общие поля item: `kind,requestId,employeeId,projectId,shiftId,expectedVersion,occurredAt`, необязательные `previousEventId,onBehalfReason`. ShiftId задаёт клиент до старта. Version — единый поток employee по всем проектам tenant,0 только до первого события; каждый принятый kind повышает его на1. Instants требуют настоящий календарь и явный Z/offset, максимум3 дробных знака. Исходный payload/offset, occurredAt и server receivedAt сохраняются раздельно. Quantity — положительная decimal JSON строка, до11 целых/3 дробных, без округления; ответ содержит3 знака.

| Kind | Дополнительные поля |
|---|---|
| shift_start | необязательный geo; открывает idle |
| segment_change | mode idle/work/break/downtime; work требует taskId; downtime требует reasonCode/comment, taskId необязателен |
| shift_end | необязательный geo; закрывает текущий сегмент и смену |
| submit_volume | taskId,reportId,submittedQuantity; только после закрытия смены и положительного закрытого work этого task в ней |

Geo строго `{latitude,longitude,accuracyMeters,capturedAt}`: диапазоны±90/±180, конечная accuracy>=0, capturedAt strict instant. Это утверждение клиента. Downtime reasonCode: materials/equipment/front/safety/weather/other; trimmed comment1–500 символов, атрибуция task только после prior work в той же смене. Дополнительные task/reason/geo поля вне своей формы запрещены. Одна открытая проектная смена employee на tenant; сегменты `[start,end)` непрерывны, нулевая длина допустима; interval marks не идут назад и новый start>=предыдущего end. Volume не меняет interval chronology. Один неизменяемый итоговый report на task/shift; incremental/corrections позже. Report occurredAt>=shift end; выше плана допускается с review flag. `acceptedQuantity:null, provisional:true`.

Worker действует только за своего active employee с текущими tenant/project memberships. Director или master с текущим project grant может действовать за другого с непустым onBehalfReason1–500. PTO только читает. Start требует active assignment/current admission; work/final volume дополнительно требуют own published managed task и точное текущее evidence, действующее сегодня и на task.workDate. Обычный выход в idle/break/downtime/end не требует нового admission. Director/granted master может закрыть время archived/revoked employee. Revoked worker теряет право отправки. Replay проверяет текущие actor/link/project права и возвращает исходный result после последующих изменений admission/task/version. Shared requestId namespace с people/tasks: иной payload/kind/operation даёт409 `idempotency_payload_mismatch`.

Review flags: delayed при receivedAt−occurredAt>24h, future при occurredAt−receivedAt>5min, geoTimeMismatch при абсолютном capturedAt−occurredAt>5min; suspicious объединяет эти три. Равенство порогам нормально. abovePlannedQuantity относится к submitted volume. Время не переписывается и не становится доказательством/подтверждёнными часами.

Все GET имеют префикс `/api/v1/projects/:p/execution`:

| Путь | Query |
|---|---|
| `/shifts` | optional employeeId,limit,offset |
| `/shifts/:shift/segments` | limit,offset |
| `/reports` | optional employeeId,taskId,day,limit,offset |
| `/employees/:employee/day` | required day; optional asOf strict instant |

Первые три возвращают `{items,total,limit,offset}`, default25/max100, сортировка ascending timestamp+UUID. Неизвестные/повторные query запрещены400. Director читает tenant, master/PTO — текущие granted projects, worker — только own employee при active link/project membership/assignment. Скрытые ресурсы404. Shifts также возвращает startEvent/endEvent с client occurredAt, server receivedAt и reviewFlags (endEvent null у открытой смены). Shift и day возвращают текущий employee stream version, включая продвижение в другом проекте без его деталей. Read snapshots информационные; totals/items могут меняться между SQL/запросами.

Day: `{employeeId,projectId,day,timezone,asOf,source:"server_as_of",version,presenceMs,idleMs,workMs,breakMs,downtimeMs,tasks:[{taskId,workMs,downtimeMs}],provisional:true,hasOpenIntervals}`. Все Ms — точные целые decimal **строки**, presence=sum четырёх modes. Обе границы гражданского дня вычисляются независимо в проверенной timezone tenant, включая23/25h DST; интервалы обрезаются по `[dayStart,dayEnd)` и min(end,asOf). Default asOf — server clock до миллисекунд; future asOf400, invalid tenant timezone422. Время до начала даёт0. hasOpenIntervals указывает открытый интервал, пересекающий выбранный день на asOf. Пустой день корректно даёт0 и tasks[]. Это provisional, approval/accepted hours отсутствуют.

Reports day и `overview.managedExecution.submittedReportsForDay` используют **submission event occurredAt** в timezone tenant, не workDate/shift start/receivedAt. Reports явно возвращают source, occurredAt,receivedAt,reviewFlags. Overview сохраняет прежние top-level legacy shift/report meanings и добавляет managedExecution с отдельными counts, exact time breakdown, per-task totals, provisional/source/asOf. Quantity суммируется только внутри unit; acceptedQuantity остаётся null. Quality/ID и старый downtimeDuration остаются unavailable. Managed записи не копируются в legacy shifts/work_reports и не считаются дважды.

Копируемый batch после подготовки assignment/admission/published task (замените employee/project/task UUID существующими; version0 допустим только для нового employee stream):

```json
{"events":[
 {"kind":"shift_start","requestId":"10000000-0000-4000-8000-000000000001","employeeId":"20000000-0000-4000-8000-000000000001","projectId":"30000000-0000-4000-8000-000000000001","shiftId":"40000000-0000-4000-8000-000000000001","expectedVersion":0,"occurredAt":"2026-11-09T09:00:00+03:00"},
 {"kind":"segment_change","requestId":"10000000-0000-4000-8000-000000000002","previousEventId":"10000000-0000-4000-8000-000000000001","employeeId":"20000000-0000-4000-8000-000000000001","projectId":"30000000-0000-4000-8000-000000000001","shiftId":"40000000-0000-4000-8000-000000000001","expectedVersion":1,"occurredAt":"2026-11-09T09:00:00+03:00","mode":"work","taskId":"50000000-0000-4000-8000-000000000001"},
 {"kind":"shift_end","requestId":"10000000-0000-4000-8000-000000000003","previousEventId":"10000000-0000-4000-8000-000000000002","employeeId":"20000000-0000-4000-8000-000000000001","projectId":"30000000-0000-4000-8000-000000000001","shiftId":"40000000-0000-4000-8000-000000000001","expectedVersion":2,"occurredAt":"2026-11-09T10:00:00+03:00"},
 {"kind":"submit_volume","requestId":"10000000-0000-4000-8000-000000000004","previousEventId":"10000000-0000-4000-8000-000000000003","employeeId":"20000000-0000-4000-8000-000000000001","projectId":"30000000-0000-4000-8000-000000000001","shiftId":"40000000-0000-4000-8000-000000000001","expectedVersion":3,"occurredAt":"2026-11-09T10:05:00+03:00","taskId":"50000000-0000-4000-8000-000000000001","reportId":"60000000-0000-4000-8000-000000000001","submittedQuantity":"1.250"}
]}
```

Если сначала отправлен второй item, отсутствующий predecessor даёт409 `missing_dependency,retryable:true` без effects. Сохраните failed/pending items, отправьте первый и повторите **тот же** второй payload/requestId; получите success. Точное повторение успешного item — duplicate с исходным result. Unrelated receipt или event другого actor/employee/project зависимостью не является. При stale_version409 прочитайте shifts/day текущую version, покажите пользователю конфликт устройств и разрешите его явно; не повышайте версии автоматически и не удаляйте failed items. Retriable500 после rollback допускает точное повторение. Серверные files/photos и hours approval/Excel добавлены в03b ниже. Browser durable queue, подключение UI и device checks остаются03c; quality acceptance/material/ID —04. Сервер03a/03b не является полной phase03/приёмкой пилота.

## Приватные вложения03b-server

Шесть защищённых операций под `/api/v1/projects/:p/evidence`:

| Метод и путь | Результат |
|---|---|
| `POST /evidence` | Резервация неизменяемой метадаты,201 `EvidenceFile` |
| `GET /evidence?employeeId=&limit=25&offset=0` | Видимые метаданные, paged `EvidenceList`; порядок reservedAt,id |
| `GET /evidence/:file` | Одна метадата,200 `EvidenceFile` |
| `PUT /evidence/:file/content` | Сырые байты,200 `EvidenceFile` с state=ready |
| `GET /evidence/:file/content` | Проверенные JPEG/PNG/PDF как attachment; не JSON |
| `POST /evidence/:file/attachment` | Неизменяемая привязка готового файла к существующему событию/отчёту,201 `EvidenceFile` |

Worker работает только со своим текущим active employee при active tenant/project membership и assignment. Director работает в своём кабинете; master — в разрешённом проекте, для резервации/привязки за другого человека передаёт `onBehalfReason`. Для PUT используется причина из резервации. PTO читает разрешённый проект, без записи. Исторические чтения менеджера не требуют действующего допуска или назначения целевого сотрудника. Отмена задачи не удаляет вложения. Права заново проверяются после ожидания блокировок и после чтения/записи файла; отзыв доступа во время I/O запрещает выдачу байтов/новый эффект.

Пример последовательности; ID, размер и SHA256 берутся из фактического файла. Для каждого metadata command создаётся новый UUID `requestId`, при повторе сохраняются исходные идентификаторы и тело:

```json
POST /api/v1/projects/${project}/evidence
{"requestId":"${reserveRequest}","fileId":"${file}","employeeId":"${employee}","filename":"photo.png","contentType":"image/png","sizeBytes":12345,"sha256":"${lowercase64hex}"}

POST /api/v1/projects/${project}/evidence/${file}/attachment
{"requestId":"${attachRequest}","target":{"kind":"execution_event","actorUserId":"${eventActor}","requestId":"${eventRequest}"}}
```

Между этими запросами отправляются байты:

```sh
curl -X PUT "http://127.0.0.1:4327/api/v1/projects/$PROJECT_ID/evidence/$FILE_ID/content" \
  -H "authorization: Bearer $TOKEN" -H "x-tenant-id: $TENANT_ID" \
  -H 'content-type: application/octet-stream' --data-binary @photo.png
curl "http://127.0.0.1:4327/api/v1/projects/$PROJECT_ID/evidence/$FILE_ID/content" \
  -H "authorization: Bearer $TOKEN" -H "x-tenant-id: $TENANT_ID" -o downloaded.png
```

Альтернативный target — `{"kind":"final_report","reportId":"${report}"}`. Он ссылается на уже созданный managed final report. Один файл привязывается ровно к одному target; target обязан совпадать по кабинету, проекту и сотруднику. Идентичность события — **tenant+actorUserId+requestId**, а не один requestId. Идентичный retry attachment с прежним requestId возвращает исходный ответ; новая команда для уже привязанного файла —409. Оригинальный ответ reserve replay может оставаться pending, даже когда GET уже ready: replay не подменяет исторический результат команды.

Резервация/attachment используют общий durable namespace tenant+actor+requestId вместе с людьми, задачами, execution и approvals. Изменение метода/пути/нормализованного тела с прежним ключом —409 `idempotency_payload_mismatch`. Резервация одного fileId с иной метадатой —409 `file_metadata_conflict`. PUT имеет другую модель: идентичность **fileId+зарегистрированные байты**, без JSON/base64 и без отдельного requestId. Повторная/конкурентная отправка тех же байтов возвращает200 с одним ready/audit; другие байты не перезаписывают файл.

Файл:1…8388608 байт, только JPEG/PNG/PDF, нижний64hex SHA256. Сервер проверяет реальную сигнатуру MIME, точный размер и SHA256. Пустые/несовпадающие байты —422; превышение8MiB —413; Content-Type кроме `application/octet-stream` —415. Content-Length необязателен при chunked; если задан, равен зарегистрированному размеру. Поток имеет реальное ограничение буфера и running limit. Прерванная передача остаётся pending и повторяется теми же байтами. Некорректный HTTP framing может быть отклонён Node до маршрута, а при разрыве клиент не обязательно получает JSON-ответ. Обычные прикладные ошибки имеют `{error:string}`, серверные5xx — только `{error:"internal"}`.

`EvidenceFile` включает заявленные поля, state pending/ready, reservedBy/reservedAt, readyBy/readyAt, onBehalfReason и attachment. Нет публичного URL, storage key или пути. Имя — отображаемая метадата, не путь. Скачивание имеет разрешённый Content-Type, `Content-Disposition: attachment` с безопасным ASCII и UTF-8 именем, `nosniff`, CSP sandbox и `private, no-store`. Pending download/attachment —409; отсутствующие или повреждённые ready-байты —503.

**Граница хранения:** текущий адаптер — приватная локальная FS: `.data/evidence-54339` либо абсолютный `HELIOS_EVIDENCE_ROOT`, каталоги0700/файлы0600, UUID-ключи, эксклюзивный временный файл→fsync→атомарный no-clobber hard-link→fsync каталогов. Это не общая атомарная транзакция FS+PostgreSQL. Ready фиксируется в БД только после проверенных байтов. Сбой БД после promotion может оставить непубличный orphan; точный retry проверяет и переиспользует его, не удаляет уже общий destination. Временные файлы очищаются. Сетевой/дисковый I/O не держит project/employee locks. Учебный S3-адаптер проверяется отдельно на `127.0.0.1` и не подменяет этот файловый адаптер стенда. Автоматическая уборка orphan, malware/AV, внешние ключи и резерв выбранного S3 остаются отдельной работой; они здесь не объявлены внедрёнными. MIME magic не является антивирусом.

## Утверждение часов и табель03b-server

Пять новых операций, без `/api/v1/projects/:p/time`:

| Метод и путь | Результат |
|---|---|
| `GET /employees/:employee/days/:day` | `TimeDay`: исходные интервалы/точные итоги, sourceHash, последняя ревизия, approvalVersion и статус |
| `GET /employees/:employee/days/:day/history?limit=50&offset=0` | Неизменяемые ревизии, version DESC; max100 |
| `POST /employees/:employee/days/:day/approvals` | Первое/повторное утверждение или исправление итогов,201 `TimeDay` |
| `POST /employees/:employee/days/:day/revoke` | Отзыв отдельной новой ревизией,201 `TimeDay` |
| `GET /export.xlsx?from=YYYY-MM-DD&to=YYYY-MM-DD` | Настоящий XLSX целиком по утверждённому диапазону |

Director утверждает/отзывает; master/PTO читают исторические дни разрешённого проекта; worker — только свои при текущем active link+grant+assignment. Историческому manager не нужен текущий допуск/назначение target. При replay заново проверяется действующее право директора, затем возвращается исходный результат, даже если позже появились ревизии/события. Полная матрица согласований относится к04. Утверждение здесь — запись решения в системе, без криптографической электронной подписи и расчёта зарплаты.

`TimeDay.source` — исходное **заявленное** время. Пять категорий `presenceMs,idleMs,workMs,breakMs,downtimeMs` передаются каноническими целыми неотрицательными десятичными строками. Общая сумма категорий равна presence. Civil day рассчитывается по действительной timezone кабинета, с точным отсечением интервалов и длительностью23/24/25ч. `recorded:true` включает закрытую нулевую смену; отсутствие записей — `recorded:false`, не фиктивная подтверждённая нулевая смена.

```json
POST /api/v1/projects/${project}/time/employees/${employee}/days/2026-11-01/approvals
{"requestId":"${approvalRequest}","expectedApprovalVersion":0,"sourceHash":"${hashFromGet}","reason":"Смена сверена мастером","acknowledgeSuspicious":true}

POST /api/v1/projects/${project}/time/employees/${employee}/days/2026-11-01/approvals
{"requestId":"${correctionRequest}","expectedApprovalVersion":1,"sourceHash":"${currentHash}","reason":"Исправлено время по журналу","confirmedTotals":{"presenceMs":"28800000","idleMs":"0","workMs":"25200000","breakMs":"3600000","downtimeMs":"0"}}

POST /api/v1/projects/${project}/time/employees/${employee}/days/2026-11-01/revoke
{"requestId":"${revokeRequest}","expectedApprovalVersion":2,"reason":"Отозвано для повторной сверки"}
```

Второй пример — отдельная optional операция, не обязательный шаг. Expected version берётся из текущего GET;0 только до первой ревизии. Required reason trim1…500; optional `confirmedTotals` — все пять полей, без дробей/экспонент/знака/leading zero. Сумма idle/work/break/downtime равна presence и не больше фактической civil-day длины. Без override подтверждаются точные sourceTotals. При override исходные интервалы и totals сохраняются, `overridden:true`, `confirmedTaskAllocation:null`: исправление общей суммы не выдумывает распределение по задачам. Принятый строительный объём не рассчитывается из утверждённых часов.

Нужны непустой recorded source, отсутствие открытых contributing интервалов и не будущая civil date. Закрытая recorded zero-time смена допускает пять нулей. `delayed`, `future`, `geoTimeMismatch`, `suspicious` исходных interval events требуют `acknowledgeSuspicious:true` и причины. Нарушение —422 `recorded_time_required`, `open_intervals`, `future_day`, `suspicious_acknowledgment_required` или `invalid_confirmed_totals`. Version/hash конфликт —409 `stale_approval_version` / `stale_source`; повторный revoke без latest approved —409 `approval_required`. Ошибка согласованности интервалов и ledger —409 `time_source_inconsistent`, без попытки угадать часы.

Source SHA256 вычисляет сервер из canonical JSON с сортированными ключами, exact clipped interval IDs/time/mode/task/ms, zero markers и определяющими interval events/flags. Равные timestamps упорядочиваются numeric employee version; identity event включает actor. Учитываются carry-in и закрывающие события; временные точки за пределами дня отсекаются. Hash не содержит transient capturedAt/asOf, глобальную stream version, unrelated day/project events или submit_volume. Поэтому валидные поздние03a события принимаются дальше, меняют только затронутый source и делают соответствующую ревизию `stale`, не переписывая утверждение. Непричастный новый день/проект/отчёт не отзывает часы.

`status` — unapproved/current/stale/revoked. `isCurrent:true` только при latest approved и совпадении hash. Каждая ревизия хранит source, sourceTotals, confirmedTotals, hash, actor/request/time/reason, previousVersion и acknowledgment. Revoke сохраняет snapshot и добавляет следующую revoked revision. Закрытые часы не редактируются в той же строке, оригинальные03a данные не меняются.

## XLSX: целостный снимок и права

Включительный диапазон от1 до31 civil days; максимум10000 recorded employee/day строк. Director или current granted master/PTO; worker получает403 даже для пустого диапазона. **Каждая** recorded строка должна иметь latest approved revision с текущим sourceHash. Иначе весь запрос409, без молчаливого пропуска или выгрузки предварительных часов. В `Error.error` возвращается строка `time_export_incomplete:<JSON array>`: до20 `{employeeId,day,status}` для исправления. Более10000 строк —422 `time_export_row_limit`. Пустой recorded диапазон — header-only `Time` и явное `empty=true` на `Snapshot`.

```sh
curl "http://127.0.0.1:4327/api/v1/projects/$PROJECT_ID/time/export.xlsx?from=2026-11-01&to=2026-11-07" \
  -H "authorization: Bearer $TOKEN" -H "x-tenant-id: $TENANT_ID" -o approved-time.xlsx
```

При success проверьте HTTP200/XLSX MIME, не сохраняйте JSON-ошибку как книгу. Файл — настоящий OOXML ZIP с листами `Time` и `Snapshot`. Он содержит project/employee ID и имя, civil date/timezone, source/confirmed пять категорий в **точных integer-ms String** и часах Number, actor/request/recordedAt, reason, version/hash/capturedAt и override. Часы округляются BigInt half-up до6 знаков; исходные ms авторитетны. Пользовательские имена/причины — типизированные String, включая начальные=,+,-,@; XML-недопустимые управляющие символы удаляются. Нет формул из пользовательского текста, предварительных объёмов, ставок, payroll или1С. MIME `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`; attachment с фиксированным ASCII именем, private/no-store/nosniff.

Один server clock/timezone и весь source+revision snapshot захватываются под упорядоченными locks project→employees→memberships/grants→heads. Перед ZIP-render locks освобождаются; после render право доступа проверяется вновь. Новое событие после capture может сделать актуальные часы stale; скачанный файл всё равно относится к **своим** capturedAt/hash/revision. Данные не подменяются новой версией во время рендера. Отозванное во время render право запрещает выдачу байтов.

Writer: exact **write-excel-file4.1.1**, MIT, Node>=18; используется Node API `.toBuffer()`. Официальные источники: [репозиторий](https://github.com/catamphetamine/write-excel-file), [документация](https://catamphetamine.gitlab.io/write-excel-file/). Установлена только API-зависимость через `corepack pnpm --filter @helios/api add --save-exact --ignore-scripts write-excel-file@4.1.1` и её transitive fflate; без parser в production. В тестах скачанный файл независимо читается Python3 stdlib zipfile/XML, включая CRC, relationship/sheet/cell types, raw ms и отсутствие formula nodes. Реально скачивается и разбирается книга на10000 строк;10001, в том числе нулевая, отклоняется.

## Проверка03b и оставшиеся границы

Новые HTTP/PG suites проверяют реальные байты, scoped composite FKs/RLS/grants/immutability, replay, rollback и current ACL после фактических PG waits и пауз I/O/render. Отдельно проверяются точные source/confirmed ревизии, relevant stale, zero/open/no-data, равные timestamps/actor identity, DST23/25ч, optimistic concurrency и оба порядка event/approval/export. OpenAPI описывает69 операций; сохранены все прежние58 и их формы/проверки. Все JSON успехи/ошибки новых suites сопоставляются со схемами по реальному HTTP status/MIME, скачивания — с binary content и headers.

Из этого worktree, только с указанными выше explicit DATABASE_URL/ADMIN_DATABASE_URL/HELIOS_DB_PORT/API_PORT:

```sh
corepack pnpm db:migrate
corepack pnpm db:migrate
corepack pnpm test
corepack pnpm --filter @helios/api exec tsx --test --test-concurrency=1 test/evidence-api.test.ts test/time-api.test.ts test/execution-api.test.ts
corepack pnpm --filter @helios/api exec tsc --noEmit
corepack pnpm --filter @helios/domain exec tsc --noEmit --typeRoots ../../apps/api/node_modules/@types
```

Обычный domain `tsc --noEmit` по-прежнему имеет прежний TS2688: локальный `@types/node` не разрешается; явный existing-typeRoots fallback указан отдельно. Это не объявляется исправленным. Тесты не заменяют физическую проверку iPhone/Android, durable client queue, S3/AV/backup/restore, нагрузочную/UX/полную приёмку пилота. UI-интеграция/очередь/телефоны —03c; матрица полномочий, quality, материалы и ИД —04; эксплуатация и комплексная приёмка —последующие работы. Раздел не меняет scope или коммерческие договорённости.

## Партии материалов

Реестр принадлежит компании, объекту и работодателю. Запись хранит материал, единицу, номер партии, поставщика, документ поставки, дату и количество поставки. Исправление добавляет следующую версию и не переписывает прежнюю. Статус этого результата всегда `awaiting_control`: запрос не принимает партию. Документ создаётся `pending` и становится `ready` только после проверки байтов. Мастер и снабжение пишут в своём объекте; снабжение ещё ограничено работодателем связанного сотрудника. ПТО читает разрешённые партии и готовые документы. Поиск и страницы считает сервер.

```sh
curl -X POST "http://127.0.0.1:4317/api/v1/projects/$PROJECT_ID/material-batches" \
  -H "authorization: Bearer $TOKEN" -H "x-tenant-id: $TENANT_ID" -H "content-type: application/json" \
  -d '{"requestId":"00000000-0000-4000-8000-000000000001","organizationId":"00000000-0000-4000-8000-000000000002","materialName":"Кирпич","unit":"шт","batchCode":"K-1","supplierName":"Завод","deliveryDocument":"УПД-1","deliveredOn":"2026-11-15","deliveredQuantity":"12.5","documents":[{"filename":"quality.pdf","contentType":"application/pdf","sizeBytes":8,"sha256":"0000000000000000000000000000000000000000000000000000000000000000"}]}'
```

Байты отправляются отдельно: `PUT .../material-batches/{batchId}/documents/{documentId}/content` с `application/octet-stream`. Незавершённая загрузка остаётся `pending` и не скачивается.

Входной контроль — отдельная команда `POST .../material-batches/{batchId}/control`. Сервер закрепляет последнюю утверждённую редакцию чек-листа и считает результат через `validateChecklist`. Роли берутся из маршрута `incoming-materials`: мастер или снабжение записывают ответы, снабжение отмечает данные, РП берёт ответственность, ПТО согласует или возвращает. Клиент не присылает вердикт. `accepted` появляется только когда последний чек-лист пройден, данные отмечены, ответственность взята и последнее согласование после этой подготовки — согласие. Критичный отказ даёт `rejected`; позднее согласие отвечает `409 control_refused` и не переписывает отказ. Согласие до данных и ответственности отвечает `409 route_incomplete`. Статус редакции партии остаётся `awaiting_control`.

В задании поле `materialBatchId` необязательно. Если оно передано, партия должна быть принята для той же зоны и вида работ, иначе `409 material_not_accepted`. Список `usable=1&zoneId&workTypeId` возвращает только такие партии. Публикация задания с обязательным контролем материала и без принятой партии возвращает `material_not_accepted`. `predecessor_acceptance_unsupported` и `id_unsupported` остаются.

## Договорные цены

Редакция неизменяема. Исправление создаёт следующую версию: `expectedVersion` равен текущему максимуму, для первой записи он 0. Прежняя строка остаётся и повторяет свой расчёт по номеру версии. На дату компании действует одна редакция вида работ с его текущей единицей. Пересечение периодов той же единицы — `price_period`, а не две действующие цены. Отсутствие редакции — не цена 0. Цена 0 допустима. Это не зарплата и не себестоимость.

Пишет и читает только роль `cost` и только объект, где у неё активное членство. Остальные бизнес-маршруты для `cost` закрыты. Повтор того же `requestId` не создаёт вторую строку. Чужой `expectedVersion` даёт `stale_version`. Журнал: `prices.record`.

`GET /api/v1/contract-prices/projects`, `GET/POST /api/v1/projects/{projectId}/contract-prices`. Единицу сервер берёт из вида работ. Импорт Excel и сводка готовности ИД в этот контракт не входят.
