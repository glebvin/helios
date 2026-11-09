# HELIOS API v1 — handoff интерфейсу

Это серверный срез **02a: люди → квалификации → допуск → назначение → бригада**, с сохранением первого API чтения. Контракт: `apps/api/openapi.json`, публично доступен через `GET /api/v1/openapi.json`: 30 операций (10 прежних + 20 новых). Другие v1-маршруты, кроме входа, требуют действующей сессии и активного членства в выбранном кабинете. Это ещё не готовый пилот.

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

02a реализует квалификации, первый допуск yes/no и бригады. Готовность и создание ежедневных задач с обязательным допуском — **02b, ещё не реализованы**. Нет полных typed/photo/measurement чек-листов качества и замечаний, простоев, 14 маршрутов и реестра полномочий, входящих материалов, ИД/АОСР/hold points, загрузки файлов, MFA/backup/операционной приёмки. Телефонный offline и конкурентная legacy-синхронизация не доказаны этими HTTP-тестами.

Legacy-запись (`/api/tasks`, `/api/sync/events`, `/api/reports/:id/accept`) сохраняет известные ограничения: неполная проверка проектных полномочий, фиксированный проект при создании задачи, неполная валидация/конкурентность offline. Эти записи **не обеспечивают новый допуск**, могут обходить workflow 02a и не сертифицированы как безопасный процесс готовности задач. Старый desk/summary и файловые маршруты не получили общего v1 ACL; в touched legacy employee-list/detail закрыта конкретная утечка чужих людей для worker. Не связывайте новые возможности с обещанием защищённых legacy-записей.

Backend API запускается на 4327, исходный UI использует 4317. Proxy/CORS для параллельной UI-копии — согласованный следующий шаг; `apps/web` этим срезом не меняется. Существующий CORS разрешает 5173 на localhost/127.0.0.1. OpenAPI servers указывает локальный backend4327.

## Проверка

Из корня репозитория после `db:up`, `db:migrate` и `db:seed` с URL из PASSPORT:

```sh
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
