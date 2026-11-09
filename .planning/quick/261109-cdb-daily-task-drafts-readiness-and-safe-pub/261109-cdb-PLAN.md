---
phase: 02b-task-preparation-publication
plan: 261109-cdb
type: execute
wave: 1
depends_on: []
autonomous: true
requirements: [API-01, ACL-01, DATA-01, TEST-01, DEV-01]
files_modified:
  - apps/api/sql/005_task_preparation.sql
  - apps/api/sql/006_task_publication.sql
  - apps/api/src/durable-command.ts
  - apps/api/src/people.service.ts
  - apps/api/src/task-input.ts
  - apps/api/src/tasks.service.ts
  - apps/api/src/tasks.controller.ts
  - apps/api/src/app.module.ts
  - apps/api/src/director-api.service.ts
  - apps/api/src/workforce.service.ts
  - apps/api/test/tasks-api.test.ts
  - apps/api/test/foundation.test.ts
  - apps/api/test/director-api.test.ts
  - apps/api/test/people-api.test.ts
  - apps/api/openapi.json
  - docs/director-api.md
  - .planning/STATE.md
estimate:
  tokens: 58000
  raw_tokens: 58000
  tasks: 3
  confidence: low
must_haves:
  truths:
    - "Director maintains real project zones/work types and front template versions; director/master prepare a single-employee task in visible projects using exact quantities and valid tenant-civil planned intervals."
    - "Master submits draft for approval; only a current director publishes a pending task. Worker sees only own published managed tasks, PTO only reads assigned projects, and plan changes invalidate readiness."
    - "Publication atomically rechecks current ACL, linked user, active employee assignment, current exact admission/evidence, qualifications on workDate, latest front attempt/template/plan revision and cross-project interval availability; dependency requirements without real modules block."
    - "Concurrent personnel/link/role/project membership/template/assignment edits cannot commit a publication based on stale prerequisites; overlapping publication yields at most one success, adjacent intervals both succeed."
    - "Published plan/evidence snapshots are immutable, and each durable successful command has one matching receipt/audit effect; exact replay reauthorizes current scope and changed operation/payload conflicts across people/task commands."
    - "Legacy create returns 410; managed tasks cannot start/end shifts, submit/accept reports or leak drafts through legacy reads; previous personnel and controlled legacy fixture tests retain their assertions."
  artifacts:
    - path: apps/api/sql/005_task_preparation.sql
      provides: "Tenant/project composite catalog references, managed plan fields/revision, immutable lineage marker, indexes and tenant RLS/grants without rewriting legacy rows."
    - path: apps/api/sql/006_task_publication.sql
      provides: "Versioned front templates, immutable front attempts/publication snapshots, protection of published plans and tenant RLS/grants."
    - path: apps/api/src/tasks.service.ts
      provides: "Catalog/draft lifecycle, readiness evaluation and ordered-lock atomic publication with transactional snapshots/audit."
    - path: apps/api/src/durable-command.ts
      provides: "Small shared receipt reservation/hash/completion plumbing preserving the existing people requestId namespace and semantics."
    - path: apps/api/test/tasks-api.test.ts
      provides: "Actual HTTP/PG contract, rollback, replay, scopes and deterministic blocking race checks against PG54339."
    - path: apps/api/openapi.json
      provides: "Concrete task/catalog/readiness operations, strict forms, errors and compatibility fields."
  key_links:
    - from: apps/api/src/tasks.controller.ts
      to: apps/api/src/tasks.service.ts
      via: "TenantGuard actor, strict task-input validation, durable commands and current transaction authorization"
    - from: apps/api/src/tasks.service.ts
      to: apps/api/src/people.service.ts
      via: "Same PoolClient and existing eligibility evaluator after project/employee/member locks; extra workDate qualification validity check"
    - from: apps/api/src/tasks.service.ts
      to: apps/api/sql/006_task_publication.sql
      via: "latest front attempt + current template/catalog versions + task planRevision; immutable publication evidence insert in transaction"
    - from: apps/api/src/people.service.ts
      to: apps/api/src/durable-command.ts
      via: "Existing people operation/hash/status contract and shared people_command_receipts namespace; no write-right expansion"
    - from: apps/api/src/workforce.service.ts
      to: apps/api/src/tasks.service.ts
      via: "Managed lineage rejection before every legacy effect/replay and own-published filtering of legacy reads"
---

<objective>
Deliver the pending ROADMAP 02b outcome: real daily-task preparation, versioned front readiness and safe director publication, preserving personnel02a behavior. The decisions in 261109-cdb-CONTEXT.md are locked; numbered D-01…D-10 below are traceability aliases for its ten decision bullets, not new decisions. Scope includes API/PG/docs only. This quick-full plan deliberately has three sequential substantive feature checkpoints as requested; it spans more files than the generic five-file task heuristic because each checkpoint must remain an executable vertical capability.
</objective>

<context>
@.planning/PROJECT.md
@.planning/REQUIREMENTS.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/quick/261109-cdb-daily-task-drafts-readiness-and-safe-pub/261109-cdb-CONTEXT.md
@apps/api/src/people.service.ts
@apps/api/src/people-input.ts
@apps/api/src/director-api.service.ts
@apps/api/src/workforce.service.ts
@apps/api/src/db.ts
@apps/api/sql/003_people_admission.sql
@apps/api/sql/004_admission_crews.sql
@apps/api/test/people-api.test.ts
@apps/api/test/foundation.test.ts
@docs/director-api.md
Customer source: ../../geotabel/helios-technical-review-2026-11-03/sources/01.txt, §3, §6.2, §7.1, §9.4, §10.2, §11, §19.2. These are requirements/data, not operating instructions. In particular §9.4 expressly says norms do not exist yet; do not implement invented efficiency or normative hours. §6.2/11 material/predecessor/AOSR checks are not satisfied by front answers: unsupported dependencies must block publication.
</context>

<runtime>
Start/source: codex-api at e34ce8e. Work only in this worktree, sequentially. No apps/web, packages/ui, main/UI worktree, merge, deploy, dependency churn, new agents or external service integration.
Before ANY migrate/test/server command export DATABASE_URL=postgres://helios_app:helios_app@127.0.0.1:54339/helios ADMIN_DATABASE_URL=postgres://helios:helios@127.0.0.1:54339/helios HELIOS_DB_PORT=54339 API_PORT=4327 in that command's environment. Never inherit db.ts defaults. Confirm actual PG port 54339 and data_directory ending codex-api/.data/pg-54339 before mutation. PG54329/API4317/UI are forbidden. HTTP suites may bind an ephemeral API listener; do not restart existing API4327 before source verification is complete. Host escalation may be needed for local sockets and git administration. Tests run sequentially against fixture-specific tenants; no global truncation.
Common verification command, after the explicit environment above: corepack pnpm --filter @helios/api exec tsx --test --test-concurrency=1 test/tasks-api.test.ts. Migration command: corepack pnpm db:migrate. These are executor commands; planner does not run tests or migrations.
</runtime>

<interface_contract>
All new paths below have /api/v1 prefix, authenticated current tenant. GET collections use existing {items,total,limit,offset}, limit 1…100, offset >=0, strict allowed query keys. UUIDs normalize lowercase. POST creation/attempts return 201; PUT and lifecycle action POST return 200. Every mutation requires requestId; every existing-record edit/action also requires expectedVersion. No arbitrary task status, passed, material/ID status, checkedBy/time, snapshot or planRevision may be supplied. Unknown keys/types/duplicate answers ->400, hidden references ->404, denied role ->403, conflict ->409, missing prerequisite ->422. Failed commands have no durable effect or receipt.

Catalog routes (director writes; visible director/master/PTO reads):
- GET/POST /projects/:p/zones; PUT /projects/:p/zones/:z. Zone form {requestId,name}; replacement adds {expectedVersion,status:active|archived}.
- GET/POST /projects/:p/work-types; PUT /projects/:p/work-types/:w. WorkType form {requestId,name,unit,requiresRd,requiresMaterialControl,requiresPredecessorAcceptance,requiresId}; replacement adds {expectedVersion,status:active|archived}. Flags are actual booleans. No norms/costing fields. Catalog responses include id/projectId/version/status.

Task preparation:
- Existing GET /projects/:p/tasks is retained and extended with optional status filter (strict known managed/legacy statuses), ordinary pagination and existing workDate filter; add GET /projects/:p/tasks/:t. Preserve old camelCase fields for legacy rows, add nullable managed fields plus workflowKind and planRevision. Worker responses omit all drafts/pending/cancelled managed tasks; only own published managed tasks pass, with the existing active project membership/assignment predicates. Director/master/PTO read visible preparation tasks; PTO never mutates. Apply the same task visibility to overview and any touched legacy desk/summary responses so draft IDs/titles/counts do not leak to workers.
- POST /projects/:p/tasks creates only managed02b draft with server id/version=1/planRevision=1. Full form {requestId,zoneId,workTypeId,title,workDate,plannedQuantity,assigneeEmployeeId,responsibleUserId,plannedStart,plannedEnd,rdReference}. rdReference is nullable, bounded nonblank metadata when supplied; if requiresRd is current true it is mandatory. There is no RD-file/registry verification claim. Unit comes from the current work type, never a client unit.
- PUT /projects/:p/tasks/:t replaces those plan fields plus {expectedVersion}, only in draft. Increment version and planRevision for any accepted plan write; readiness immediately becomes stale. Cross-tenant/project catalogs and inactive refs are rejected. Responsible user must be active same-tenant director or assigned master; employee may remain unlinked per02a. A linked employee's current membership must be active, and a linked worker's project membership active at publication.
- POST /projects/:p/tasks/:t/submit {requestId,expectedVersion}: director/master, draft -> pending_approval, structural refs/form complete; readiness/admission may still be incomplete and are rechecked on publication.
- POST /projects/:p/tasks/:t/reject {requestId,expectedVersion,reason}: director, pending_approval -> draft.
- POST /projects/:p/tasks/:t/reopen {requestId,expectedVersion,reason}: director/master, pending_approval -> draft (master withdraws own visible preparation); published cannot reopen in this slice.
- POST /projects/:p/tasks/:t/cancel {requestId,expectedVersion,reason}: director for draft/pending/published, master for draft/pending. Terminal cancelled; retain publication snapshot and audit. No published plan editing/correction/production transitions.

Front readiness:
- GET/POST/PUT /projects/:p/front-template and GET /projects/:p/front-template/versions. One family per project; director-only writes. POST {requestId,code,title,items:[{id,label,critical}]}; PUT {requestId,expectedVersion,title,items}. Family code stable, nonempty unique items <=100, versions immutable; latest pointer advances under project lock.
- GET/POST /projects/:p/tasks/:t/front-checks; GET /projects/:p/tasks/:t/front-checks/:check. Director/master records only draft/pending tasks; workers cannot inspect these preparation endpoints, PTO reads visible records. POST {requestId,expectedVersion,templateVersion,answers:[{itemId,value:boolean}]}. Reject missing/extra/duplicate IDs. Lock task and compute full attempt snapshot {id,sequence,taskId,planRevision,templateCode,templateVersion,templateSnapshot,zoneVersion,workTypeVersion,answers,passed,reasons,warnings,checkedBy,checkedAt}; immutable failed attempts count as latest. Critical false blocks; noncritical false warns. Recording attempt increments task.version, not planRevision, so concurrent checks/edits obey expectedVersion.
- POST /projects/:p/tasks/:t/publish {requestId,expectedVersion}: director only, pending_approval -> published. Check every condition in publication protocol below; insert immutable plan/evidence snapshot and audit, update task/version, complete receipt atomically. Return task plus snapshot reference, readiness/reasons and exact decimal strings. Unready ->422 task_not_ready (structured reasons if following the existing error envelope is extended); stale version/template ->409; overlapping published interval ->409 assignment_overlap. Give concrete reason codes for no/latest-failed/stale front, inactive assignment, changed/expired admission, RD missing and each unsupported dependency. Do not widen the public global error envelope merely for this slice: a stable error code plus documented reasons on preparation reads is acceptable if detailed errors require unrelated churn.

Validation choices: quantity is a JSON string matching unsigned decimal syntax with at most 11 whole digits and 3 fractional digits for numeric(14,3), strictly >0; reject numeric JSON, exponent/sign/NaN/infinity/overflow and excess scale rather than round or truncate. Canonicalize decimal text without Number/parseFloat (the current domain parser truncates at six places and is not sufficient input validation). workDate is required day() value, years 0001…9999; never pass undefined to a date cast. plannedStart/plannedEnd are strict RFC3339 timestamps with explicit Z or numeric offset, real calendar/time/offset ranges and at most millisecond precision (reject excess precision); normalize to instants, require start < end. Stored tenant timezone must exist in pg_timezone_names, no hardcoded Moscow fallback. Convert both instants into tenant civil time and require their dates equal workDate; reject cross-day, absent/invalid timezone, invalid offset/local time. Store timestamptz and tenant timezone in publication snapshot. Overlap uses [start,end): newStart < existingEnd AND newEnd > existingStart across all tenant projects for this employee; exact adjacency allowed. No legacy row without intervals is declared conflict-checked.
</interface_contract>

<publication_protocol>
Use withTenant's READ COMMITTED transaction. Reread the existing service before implementing; maintain its NO KEY UPDATE/FK KEY SHARE compatibility. A small shared helper may own canonical hashing, reserve/lookup/complete receipt plumbing over people_command_receipts, but role/scope authorization remains per-service. Preserve existing people operation strings and normalized hash inputs exactly; task commands share the same (tenant,actor,requestId) namespace, so reuse across people/task paths conflicts. Authorization precedes returning a replay; replay bypasses later business invalidation/version/front checks and returns original body/status with no new audit. Never create a second task-only idempotency namespace.

For new commands, reserve receipt before entity locks. If a completed matching receipt already exists, use a separate replay branch: project lock -> current actor membership -> applicable project membership, with fresh current scope/role checks and no later employee/task/assignment locks. Return the original stored body/status; do not evaluate original expectedVersion, plan/front/admission or catalog state. A replay branch that takes membership locks must NEVER subsequently acquire employee locks. PeopleService retains its established authorization/replay behavior. If the receipt is newly reserved, continue with the full mutation protocol:
1. Lock target project row FOR NO KEY UPDATE (tenant+project equality only). This serializes supported project membership, admission template/check, front/catalog and task commands. Do not obtain actor membership locks before project/employee locks.
2. For an existing task, get its project/assignee/responsible/version only as an UNTRUSTED nonlocking hint. Lock all hinted/current-input employees sorted by employee ID FOR NO KEY UPDATE using tenant/id only. For a draft reassignment include old and new assignees in sorted order. Never include visibility joins/predicates in the lock statement. Employee-lock return is current; reread employee separately after waiting, so changed user link/archive is observed. Never take project locks from the employee archive path (it currently locks employee -> memberships -> assignments/crew); publication may wait for archive while holding project because archive never waits for that project.
3. From the fresh employee rows and hinted/new responsible IDs, lock unique memberships for actor, linked employee user and responsible user sorted by user_id FOR NO KEY UPDATE. This is after employees even when actor is director. Lock applicable project_memberships in deterministic key order and task/assignment-related rows last, compatible with existing project -> employee -> membership -> assignment/crew ordering. Read fresh membership roles/status and project links in NEW statements after all waits, rather than trusting AuthGuard's cached Actor.role or an earlier projectExists result.
4. Lock task/assignment rows NO KEY UPDATE, then freshly reread task and all authority/required references. If task version, assignee, responsible or project differs from hint/expectedVersion, abort stale_version and rollback; do not acquire a newly discovered earlier-tier lock and do not retry within the same transaction. No task/assignment lock before employee. Scope all SQL by tenant plus project/id; denied/foreign rows produce controlled 4xx.
5. After lock waits, perform separate READ COMMITTED statements for current actor authority (role+active membership; director global or master's active project link), responsible authority, employee archive/link/member status, assignment row/status/checkId, latest admission template and latest attempt/evidence. Avoid a single joined SELECT ... FOR UPDATE that evaluates member/qualification/template predicates against the statement snapshot taken BEFORE waiting. Employee-only edits/qualification writes serialize on employee, project template/check/assignment/membership writes on project, and member role/revocation updates serialize on the locked memberships. When role or membership was revoked while command waited, reject with no effect even if Guard already authenticated it.
6. Reuse the SAME personnel eligibility(c,employee,p,assignment.admissionCheckId) evaluator on this SAME PoolClient, exposed as a documented internal method (plus evidence helper if needed), without duplicating its latest-attempt/template/qualification-id/version checks or widening people write rights. Keep current tenant-civil-date eligibility. Additionally inspect the exact active required qualification evidence for inclusive validUntil >= task.workDate; a document valid today but expiring before a future workDate blocks. Both gates apply.
7. Read latest front attempt INCLUDING failed, latest template/catalog versions and planRevision. Require latest attempt passed and all bindings current. Check required RD and current catalog active status/unit. Any requiresMaterialControl/requiresPredecessorAcceptance/requiresId true yields explicit unsupported/not_ready reasons; front yes answers cannot override absent modules. Persist current admission/check/template/qualification evidence, linked user/assignment and front/template/catalog/actor/time alongside all plan fields and interval/timezone in immutable publication snapshot.
8. Under the employee lock, run a fresh overlap query across all projects on published managed rows with real intervals. The employee row serializes concurrent publication in DIFFERENT projects, so do not acquire those other projects' locks. Never lock another project's task rows for overlap. A later fresh statement sees the winner's commit under READ COMMITTED. Cancel uses the same order before releasing an interval. Commit task update, snapshot, audit and receipt together; rollback all on conflict/failure.

Ordinary GETs may observe changing count/list/currentAdmission across statements; document this ordinary READ COMMITTED consistency. Their displayed readiness is advisory. Publication and lifecycle mutations are atomic and never trust an earlier GET or client-computed pass. Do not add SERIALIZABLE retries, advisory lock schemes, DB extensions or global lock refactors unless a demonstrated requirement cannot be met with the established row locks.
</publication_protocol>

<tasks>

<task type="tracer" tdd="true">
  <name>Task 1: Director catalogs and master draft preparation through real HTTP/PG</name>
  <files>apps/api/sql/005_task_preparation.sql, apps/api/src/durable-command.ts, apps/api/src/people.service.ts, apps/api/src/task-input.ts, apps/api/src/tasks.service.ts, apps/api/src/tasks.controller.ts, apps/api/src/app.module.ts, apps/api/src/director-api.service.ts, apps/api/src/workforce.service.ts, apps/api/test/tasks-api.test.ts</files>
  <behavior>Director creates project zone/work type, assigned master creates/edits and rereads a valid draft; its unit is server-derived and worker cannot see it through v1/legacy list/detail/overview. Foreign catalogs, unauthorized roles, forged state, invalid dates/decimals/intervals and stale edit reject with no receipt/audit/task changes. Concurrent identical commands return identical status/body and one effect; people/task requestId operation mismatch conflicts.</behavior>
  <action>
    Implement D-01/D-02/D-03/D-08 and preparation isolation portion of D-09. Write targeted real HTTP failing cases first; use unique tenant/project/employee fixtures modeled on people-api.test.ts. Seed each task-test employee/assignment through established02a commands where its behavior is under test; controlled admin fixture setup is acceptable for external invalidation/race probes, never a bypass in production endpoints.
    Add 005 migration with real project_work_zones and project_work_types (tenant/project/id composite FKs/uniques), version/status and the stated flags/unit; additive managed fields on daily_tasks: workflow_kind with old rows explicitly legacy, zone/work_type/responsible/RD/interval fields, plan_revision and project-scoped task unique key. Use row checks enforcing complete managed plan shape/date/positive quantity/start-end and allowed managed preparation statuses while retaining old status names/nullable fields for legacy rows. Do not invent intervals/admission for old tasks. Make workflow marker immutable; restrict app DELETE/UPDATE paths using grants/triggers as needed so a managed task cannot be relabeled legacy. New catalog tables FORCE RLS tenant policies and explicit limited grants; supporting indexes for project reads/assignee published overlaps.
    Retain existing daily_tasks tenant/project and tenant/assignee composite FKs; add (tenant_id,responsible_user_id) -> memberships(tenant_id,user_id) and (tenant_id,project_id,zone_id/work_type_id) -> each matching project catalog composite key. A standalone UUID FK is insufficient for these new references. Current active/role/project eligibility remains a server check under the ordered locks.
    Extract only small receipt helpers and make PeopleService consume them preserving people authorization/operation strings/replay behavior; do not copy its private command method as a second implementation or make it public with implicit director-only semantics for master commands. Keep people write authority director-only. Implement the specified project/employee/member order for catalog and draft commands now; extend it in Task2 rather than introducing reverse locks. Wire Nest providers/controller without UI changes. Hide preparation rows in legacy desk and summary as needed immediately when drafts become possible.
    [BLOCKING] After schema edits, run the existing ledgered SQL migrate command against verified PG54339 BEFORE tests; rerun and compare ledger/data. This repo uses handwritten pg SQL, not an ORM push or destructive db reset.
  </action>
  <verify>
    <automated>
export DATABASE_URL=postgres://helios_app:helios_app@127.0.0.1:54339/helios ADMIN_DATABASE_URL=postgres://helios:helios@127.0.0.1:54339/helios HELIOS_DB_PORT=54339 API_PORT=4327 &&
corepack pnpm db:migrate &&
corepack pnpm db:migrate &&
corepack pnpm --filter @helios/api exec tsx --test --test-concurrency=1 --test-name-pattern="catalog|draft|quantity|interval|receipt" test/tasks-api.test.ts &&
corepack pnpm --filter @helios/api exec tsx --test test/people-api.test.ts &&
corepack pnpm --filter @helios/api exec tsc --noEmit
    </automated>
    <manual>Before running the commands, confirm actual port54339 and data_directory ending codex-api/.data/pg-54339. Inspect the live migration ledger for005 and compare ledger/data across the repeat migration.</manual>
  </verify>
  <done>Real catalog → master draft → read/edit works, permissions/input/replay/rollback are proven; workers cannot discover drafts; prior people suite is green without changed business assertions. Commit only implementation/test changes for this checkpoint.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Versioned front checks, approval state machine and race-safe publication</name>
  <files>apps/api/sql/006_task_publication.sql, apps/api/src/task-input.ts, apps/api/src/tasks.service.ts, apps/api/src/tasks.controller.ts, apps/api/src/people.service.ts, apps/api/src/director-api.service.ts, apps/api/test/tasks-api.test.ts</files>
  <behavior>Complete draft → pending_approval → published with current admission/front and immutable snapshot succeeds; master cannot publish, PTO cannot prepare, worker sees own published task. Rejection/reopen/cancel require reason and exact version; published plan edit fails. Latest failed/obsolete front, changed plan/catalog/template/admission/evidence or unsupported material/predecessor/ID blocks. Future workDate beyond qualification expiry blocks although current eligibility passes. All stated races serialize to a valid ordering with no deadlock/stale publication.</behavior>
  <action>
    Implement D-04/D-05/D-06/D-07/D-08 and all lifecycle/front/publication routes/forms above. Build 006 with one front family/project, immutable versions/attempts and immutable task_publication_snapshots, composite tenant/project/task/template references, monotonic sequence/unique snapshot identity, indexes, FORCE RLS, SELECT/INSERT-only history grants. Protect published plan columns/lineage/snapshot reference against app modification and snapshot against UPDATE/DELETE; cancellation may change status/version with audit but leaves plan/snapshot untouched. Capture legacy plan fields as well as new refs, revision and exact quantity string in publication snapshot. Catalog or personnel edits later must not rewrite old snapshots.
    Expose existing personnel eligibility as an internal same-client operation and retain its old callers unchanged in behavior. Add only the workDate evidence gate to task publication. Apply publication_protocol literally, including fresh statements after lock waits, linked employee status/role check and actor role/project link recheck; receipt replay also reauthorizes current scope under these locks but returns the original result despite later business invalidation. Recording a failed readiness attempt is a successful durable command and invalidates a previous passing attempt as latest.
    Implement deterministic PG races using held admin project/employee/member row gates and pg_blocking_pids with bounded timeout/finally release (existing people tests show pattern), not sleeps as correctness evidence. Cover both orderings where meaningful: front/template publication vs task publish; plan edit/reopen vs submit/publish; qualification revoke/update vs publish; employee archive/link edit vs publish; assignment revocation vs publish; actor membership role/revocation and master project-membership revocation after Guard but before mutation/replay; responsible member/project link revocation. Include a gate sequence proving a transaction waiting on employee then membership cannot read the pre-wait member snapshot, and changed employee link uses the new membership rather than an old grant. Queue overlapping publish in different projects for one employee behind an employee gate; exactly one succeeds, no deadlock; adjacent intervals both succeed. Do not take second-project locks or task locks in overlap reads.
    In every failed new command assert unchanged task.version/state, zero new receipt/snapshot/audit and no shift/report/job effects. Test atomic rollback by a transaction failure after tentative publication writes (fixture-controlled DB constraint/trigger, removed in finally) so the test proves rollback of snapshot/task/receipt/audit, not only prevalidation. Retry same requestId after failed validation can succeed once fixed. Preserve identical concurrent replay and cross-operation mismatch. Verify immutable snapshots after catalog/qualification edits, exact evidence IDs/versions and planRevision.
    [BLOCKING] Apply 006 with corepack pnpm db:migrate against verified PG54339 before runtime verification; repeat migration without ledger/data changes.
  </action>
  <verify>
    <automated>
export DATABASE_URL=postgres://helios_app:helios_app@127.0.0.1:54339/helios ADMIN_DATABASE_URL=postgres://helios:helios@127.0.0.1:54339/helios HELIOS_DB_PORT=54339 API_PORT=4327 &&
corepack pnpm db:migrate &&
corepack pnpm db:migrate &&
corepack pnpm --filter @helios/api exec tsx --test --test-concurrency=1 test/tasks-api.test.ts &&
corepack pnpm --filter @helios/api exec tsx --test --test-concurrency=1 test/tasks-api.test.ts &&
corepack pnpm --filter @helios/api exec tsx --test test/people-api.test.ts &&
corepack pnpm --filter @helios/api exec tsc --noEmit
    </automated>
    <manual>Before running the commands, confirm the isolated PG port/data_directory. Compare ledger/data across the repeat migration. Inspect deterministic race assertions/DB outcomes, app grants and immutable-row rejection; the repeated task suite must demonstrate fixture cleanup as well as races.</manual>
  </verify>
  <done>Director publication and all preparation transitions are real and atomic; failed dependencies are explicit; exact current+workDate admission and latest front binding enforced; actual lock races show valid serialization and cross-project overlap safety. Personnel02a stays green. Commit this feature checkpoint.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Fence legacy execution, deliver OpenAPI/docs and complete regression evidence</name>
  <files>apps/api/src/workforce.service.ts, apps/api/src/app.module.ts, apps/api/test/foundation.test.ts, apps/api/test/director-api.test.ts, apps/api/test/people-api.test.ts, apps/api/test/tasks-api.test.ts, apps/api/openapi.json, docs/director-api.md, .planning/STATE.md</files>
  <behavior>Authenticated legacy POST /api/tasks returns 410 task_creation_retired with documented replacement; direct service create cannot bypass it. Every managed draft/pending/published/cancelled task rejects legacy shift_start/shift_end/submit_volume/report acceptance with workflow_not_supported before effects or event receipt/replay. Existing controlled legacy fixture preserves rollback/pg-boss replay assertions. Every documented operation/form/status matches real HTTP and role scope; prior domain/API behavior stays green.</behavior>
  <action>
    Implement D-09/D-10. Retire legacy create at the service entry point as well as route behavior. Guard managed lineage in sync processing BEFORE existing client_events replay lookup so a stored old event result cannot authorize execution; guard each task-referencing dispatch path and report acceptance via report.task_id, including forged employeeId and preexisting report/shift fixture probes. All managed states reject, including published (phase03 execution is absent). Resolve missing/foreign refs without leaking tasks. Guard recordAndMaybeRollback's task selection too: replace nondeterministic LIMIT1 with an explicit controlled legacy fixture taskId parameter at its test-only call site (or equivalent deterministic scoped choice), preserve its transaction/job semantics and ensure it cannot mutate managed tasks. Existing legacy fixture tasks retain compatible execution solely for the foundation assertions, not a certified admission workflow.
    Replace foundation.test.ts legacy creation with an explicit scoped insert of a legacy fixture, with controlled id and cleanup; assert retired endpoint410 separately (including former foreign-create probe), move actual foreign-reference creation rejection to new v1 task tests. Retain zero job on rollback, exact one report/job/effect on replay and tenant mismatch403 assertions. Add zero business/event receipt/job/audit assertions for every managed legacy mutation attempt. If legacy desk/summary/employee views touch preparation, retain own/project scope of managed rows and do not present legacy tasks as readiness-certified.
    Update OpenAPI with all interface_contract routes and reusable strict schemas: managed/legacy task shape, catalogs, front versions/runs, publication snapshot, lifecycle forms, exact decimal/RFC3339/date/nullable fields and error statuses. Keep existing fields/paths. Existing director/people tests hardcode operation counts12/30: update expected total/path assertions for the additive contract while preserving checks of EVERY previous operation/schema and all previous response/role/rollback assertions. Add contract checks for task responses, strict inputs, immutable snapshot and pagination; no count reduction or disabled tests.
    Rewrite obsolete docs claims that02b is pending/legacy create remains open. Document current lock/replay and GET consistency, role matrix, concrete forms and sample lifecycle, RD metadata semantics, future-date qualification rule, supported interval precision, worker visibility, legacy410/rejection and replacement path. Explicitly keep multiple executors, norms, real material/ID/hold points/AOSR, execution/files/offline/authority/full pilot pending; no full TZ6.2 acceptance claim. Update STATE only with measured checkpoint/test evidence and remaining limitations; do not alter canonical Brain (parent owns project-state update).
    Run full prior domain/API suites and tsc under explicit env, migration repeat, whitespace diff check. Only after source tests pass may parent restart/check API4327. Executor commits implementation checkpoints only; write SUMMARY and STATE evidence, leave independent verification to parent.
  </action>
  <verify>
    <automated>
export DATABASE_URL=postgres://helios_app:helios_app@127.0.0.1:54339/helios ADMIN_DATABASE_URL=postgres://helios:helios@127.0.0.1:54339/helios HELIOS_DB_PORT=54339 API_PORT=4327 &&
corepack pnpm test &&
corepack pnpm --filter @helios/api exec tsc --noEmit &&
corepack pnpm --filter @helios/domain exec tsc --noEmit &&
corepack pnpm --filter @helios/api exec tsx --test --test-concurrency=1 test/tasks-api.test.ts &&
corepack pnpm db:migrate &&
git diff --check e34ce8e --
    </automated>
    <manual>Before running the commands, confirm the isolated PG port/data_directory. Confirm the repeat migration preserves ledger/data and no forbidden paths/ports were touched. Document measured test totals and any failures; inspect that all prior business assertions remain.</manual>
  </verify>
  <done>Legacy create/execution bypasses closed for managed tasks, all old assertions retained with controlled legacy fixture, complete contract/docs reflect tested behavior, full regression/tsc and repeat task suite pass. SUMMARY records evidence/limits and independent-verifier handoff; implementation checkpoint committed, no merge/deploy.</done>
</task>

</tasks>

<source_audit>
| Source | Item | Coverage |
|---|---|---|
| GOAL | ROADMAP02b task creation/readiness with admission enforcement | Tasks1–3; no production execution claim |
| REQ | API-01, ACL-01, DATA-01 | Tasks1/2 scoped real reads/writes, old fields and unavailable later modules; Task3 contract |
| REQ | TEST-01, DEV-01 | All checkpoints actual PG/HTTP, isolated runtime and full regression |
| REQ | Subsequent pilot slice daily tasks/readiness | Tasks1/2; shifts/offline/files and other pilot slices remain scoped to03–05 |
| CONTEXT | D-01 real zone/work-type records, RD server validation/no norms | Task1, Task2 current refs/snapshot |
| CONTEXT | D-02 complete single-employee plan/exact date/quantity/interval/overlap | Task1 validation, Task2 serialized overlap |
| CONTEXT | D-03 preparation/approval/read role scope/no supplied status | All tasks |
| CONTEXT | D-04 lifecycle/reasons/immutable published plan/audit | Task2 |
| CONTEXT | D-05 immutable versioned yes/no front, latest failed/template/plan binding | Task2 |
| CONTEXT | D-06 transactional authority/admission/front/overlap, races/order | Task2 publication_protocol |
| CONTEXT | D-07 absent material/ID/predecessor modules fail closed | Task2 |
| CONTEXT | D-08 requestId/version/receipt/audit/replay/refs/RLS/helpers | All tasks |
| CONTEXT | D-09 retire creation/foundation fixture/fence legacy mutations | Task3; Task1 read isolation |
| CONTEXT | D-10 no UI/uploads/multi-executor/norms/full-pilot claim | Runtime, interface, Task3 docs |
| RESEARCH | No separate RESEARCH.md exists; live source/schema/test findings | Internal discovery in this plan, all reflected in protocol/tests |
| CUSTOMER | §3/6.2/7.1/10.2/19.2 preparation/front/admission/lifecycle | Tasks1/2; later execution/signatures/norms explicitly outside this slice per CONTEXT |
| CUSTOMER | §9.4 norms absent; §11 unsupported material/ID/hold point prerequisites | Tasks2/3 fail-closed + accurate boundary |
| STEERING | Qualification valid on workDate inclusive; explicit offset/tenant-civil date/adjacent interval | Interface contract, Task2 tests |
</source_audit>

<assumption_delta_decision>
Primary noun: single-assignee daily task with immutable published plan revision. Decision: no-change to assignee identity per locked scope; promote project-scoped catalog references and explicit managed workflow as authoritative for new tasks. Legacy display fields remain compatibility projections; no parallel free-text authoritative zone/type/unit model. Multiple-executor attribution is deferred by owner, not implicitly represented by crew membership.
No external API integration: this slice extends HELIOS internal Nest/pg endpoints only. plan:pre active planner contributions were reviewed: apply security model and blocking ledgered SQL migrations; no ORM push, external integration or UI phase is invented. Calibration factor1/sample_count0/confidencelow yielded the estimate above.
</assumption_delta_decision>

<threat_model>
ASVS level1; unresolved high/critical risks block verification.
| ID | Boundary/threat | Severity | Mitigation/evidence |
|---|---|---|---|
| T-02b-01 | Client -> API role/project/foreign task/catalog spoofing and worker draft disclosure | high | Current locked actor/project/member reauthorization, tenant composite refs, strict inputs, all-role/tenant/project/own HTTP cases |
| T-02b-02 | Guard/read -> transaction stale admission/link/role/template/assignment or overlapping publication | high | Ordered row locks, fresh post-wait READ COMMITTED reads, same-client evaluator, future-workDate expiry, deterministic PG gates and cross-project races |
| T-02b-03 | Client readiness/pass/precision/status tampering | high | Server compute/version/revision binding, strict exact decimal/date/offset validation, unsupported prerequisites deny, tests for forged fields |
| T-02b-04 | Receipt/audit/snapshot replay or rollback inconsistency | high | Shared global requestId namespace, original hash semantics, atomic receipt+snapshot+audit, replay authorization, failure injection + immutable grants |
| T-02b-05 | Legacy write path bypasses managed readiness/execution scope | high | Create410, lineage guard before event replay and dispatch/report acceptance, no effects/jobs tests; lineage immutable |
| T-02b-SC | Package supply chain | high | No installation/dependency changes required or allowed |
</threat_model>

<verification>
Independent verifier must trace all six must_haves to working endpoints + actual DB assertions, inspect SQL/grants and lock statements for inverse acquisition and pre-wait snapshot joins, verify current/personnel behavior and future-date gate, then run isolated full regression/tsc and inspect OpenAPI/docs. Compilation alone cannot certify schema/publication atomicity. Absence of races/receipt rollback evidence is a failed verification. Ordinary read consistency and legacy rows without intervals remain documented limits.
</verification>

<output>
Create .planning/quick/261109-cdb-daily-task-drafts-readiness-and-safe-pub/261109-cdb-SUMMARY.md with commits, exact tests/schema/race evidence and unresolved limitations. Update .planning/STATE.md only to the verified implementation stage; parent independently verifies, commits planning artifacts and updates canonical Brain. No UI/main merge/deploy or complete-pilot claim.
</output>
