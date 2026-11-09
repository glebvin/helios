---
phase: 02a
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - apps/api/sql/003_people_admission.sql
  - apps/api/sql/004_admission_crews.sql
  - apps/api/src/people.service.ts
  - apps/api/src/people.controller.ts
  - apps/api/src/people-input.ts
  - apps/api/src/director-api.service.ts
  - apps/api/src/app.module.ts
  - apps/api/test/people-api.test.ts
  - apps/api/test/director-api.test.ts
  - apps/api/test/foundation.test.ts
  - apps/api/openapi.json
  - docs/director-api.md
autonomous: true
requirements: [ACL-01, TEST-01, DEV-01, PEOPLE-02A]
must_haves:
  truths:
    - An active tenant director can create/edit/archive a person, manage qualifications, record a versioned yes/no admission and safely assign the person to a project and crew through authenticated HTTP.
    - Workers see their own personnel records; master/PTO see explicitly assigned projects and their personnel; foreign and unassigned personnel remain inaccessible.
    - A recorded pass alone never establishes current eligibility; latest project template, latest check, current required qualification versions, civil-date expiry and employee status are rechecked.
    - Durable commands are atomic with audit and receipts; concurrent duplicate requestIds cannot duplicate business effects, and stale versions cannot overwrite changes.
    - Existing read fields and historical assignments/checks survive without fabricated admission backfill; backend 02a does not claim task readiness or full pilot completion.
  artifacts:
    - path: apps/api/sql/003_people_admission.sql
      provides: Tenant-safe people/qualification persistence, versions, receipts, audit detail and indexes
    - path: apps/api/src/people.service.ts
      provides: Transactional director writes, scoped reads and current admission evaluation
    - path: apps/api/src/people.controller.ts
      provides: Reachable guarded v1 command/read routes
    - path: apps/api/test/people-api.test.ts
      provides: Real HTTP/PostgreSQL flow, authorization and concurrency regression evidence
    - path: apps/api/openapi.json
      provides: Complete executable API handoff contract
    - path: apps/api/sql/004_admission_crews.sql
      provides: Immutable template/check persistence, assignment lineage, crews and scoped constraints
  key_links:
    - from: apps/api/src/app.module.ts
      to: apps/api/src/people.controller.ts
      via: Nest controller/provider registration and existing TenantGuard
    - from: apps/api/src/people.service.ts
      to: apps/api/src/director-api.service.ts
      via: Reused public visibility helpers on existing service; unchanged project/employee scope semantics
    - from: apps/api/src/people.service.ts
      to: apps/api/sql/003_people_admission.sql
      via: withTenant transaction, command receipt reservation, employee/template locks, version compare and audit
    - from: apps/api/test/people-api.test.ts
      to: apps/api/src/people.controller.ts
      via: Authenticated HTTP against real isolated PostgreSQL54339
---

<objective>
Deliver the backend 02a people flow: employee → qualifications → immutable admission evidence → project assignment → crew. Preserve phase01 read compatibility and document exactly what the UI can call. Base is 22588a9 in codex-api. Daily-task writes/readiness are phase02b; all other pilot capabilities remain later. No frontend, new dependencies, account invitations, main merge, deployment, photo/file checklist or physical-phone claims.
</objective>

<context>
@.planning/PROJECT.md
@.planning/REQUIREMENTS.md
@.planning/STATE.md
@.planning/ROADMAP.md
@.planning/quick/261109-bkb-people-qualifications-admission-checks-c/261109-bkb-CONTEXT.md
@PASSPORT.md
@docs/director-api.md
@apps/api/sql/001_init.sql
@apps/api/sql/002_project_access.sql
@apps/api/src/director-api.service.ts
@apps/api/src/auth.service.ts
@apps/api/src/db.ts
@apps/api/test/director-api.test.ts
</context>

<contract>
All paths below have /api/v1 prefix. All business POST/PUT bodies require UUID requestId; every update/revocation also requires positive integer expectedVersion, except the explicitly documented create-only membership/assignment/crew-member PUTs accept zero. IDs are server-generated UUIDs for creates. Unknown body/query fields, duplicate item IDs/codes, invalid UUID/date/boolean/version and malformed arrays are 400. Nonempty trimmed name/title/code/labels and bounded arrays/text are validated explicitly without dependencies. GET uses existing 200 and paged {items,total,limit,offset}; POST returns 201 and PUT 200, including replay of the original status/body. Existing auth/me/project/task/overview operations remain compatible. 401 session, 403 role, 404 hidden/missing scoped IDs, 409 stale_version/idempotency_payload_mismatch/crew_conflict/template_changed, 422 reference_denied/admission_required. Use existing error envelope.

Employee E = existing {id,fullName,phone,organizationId,userId} plus {version,status}; no document_number in registries. POST /employees {requestId,fullName,organizationId,phone?,userId?} → E. PUT /employees/:id {requestId,expectedVersion,fullName,organizationId,phone,userId,status:'active'|'archived'} → E; full replacement of these editable fields, nullable phone/userId. Archived is terminal. Existing GET /employees and /employees/:id retain their fields and add version/status. Creating/linking does not create a login; verify same-tenant active membership and organization on create/update, never accept role/tenant/user account data. Do not expose document numbers via these routes.

Qualification Q = {id,employeeId,code,title,documentReference,validUntil,status,version}; documentReference is nullable metadata, not an upload. GET /employees/:id/qualifications paged, historical/expired included. POST same path {requestId,code,title,documentReference?,validUntil?} → Q. PUT /employees/:id/qualifications/:qid {requestId,expectedVersion,title,documentReference,validUntil,status:'active'|'revoked'} → Q; code immutable, revoked terminal, renewal creates a new row after revoking predecessor. At most one active row per employee/code; expired active rows still occupy that slot until explicitly revoked. Metadata changes increment version even when code remains identical.

Each project has exactly one admission template family, identified by immutable code; this avoids selecting a weaker alternative to satisfy assignment. It is project-bound and tenant-scoped. T = {projectId,code,title,version,items:[{id,label,critical}],requiredQualificationCodes:[]}. Items use unique nonempty string IDs; every answer is boolean. GET /projects/:p/admission-template → latest T (404 if absent); GET /projects/:p/admission-template/versions paged → immutable versions. POST /projects/:p/admission-template {requestId,code,title,items,requiredQualificationCodes} → T version1; PUT same path {requestId,expectedVersion,title,items,requiredQualificationCodes} → appended T version+1, code unchanged. Both items and qualification-code lists reject duplicates; require at least one item. These reads follow project visibility.

GET /employees/:e/admission-checks?projectId=:p paged and GET /employees/:e/admission-checks/:id → C. POST /employees/:e/admission-checks {requestId,projectId,templateVersion,answers:[{itemId,value}]} → C. C={id,employeeId,projectId,templateCode,templateVersion,sequence,answers,templateSnapshot,qualificationEvidence:[{id,code,version,validUntil,status}],checkedBy,checkedAt,civilDate,passed,reasons:[],warnings:[]}. Exactly every item must be answered once; unknown/missing/duplicate answers return 400. Stale templateVersion returns 409. Critical false and missing/expired/revoked required evidence yield persisted passed:false and reasons; noncritical false yields warning only. No client passed/check time/evidence. Reads require BOTH employee visibility and referenced project visibility; no registry leak through history or documentReference.

GET /projects/:p/memberships paged → {projectId,userId,role,status,version} rows; director only because this exposes membership administration. PUT /projects/:p/memberships/:user {requestId,expectedVersion,status:'active'|'revoked'} → same shape; expectedVersion=0 means create only, otherwise compare current version. Target must be an existing active tenant member, role returned from memberships and never written here. No user directory/invitation endpoint.

GET /projects/:p/assignments paged → A={projectId,employeeId,status,version,admissionCheckId,currentAdmission:{eligible,reasons,checkId,templateVersion}}. Restrict rows by employee visibility as well as project visibility. PUT /projects/:p/assignments/:e {requestId,expectedVersion,status:'active'|'revoked',admissionCheckId?} → A; expectedVersion=0 means create only. Active always requires admissionCheckId, including reactivation or refreshing evidence on an existing active row. Revoked omits it. A linked worker's active tenant membership is required; successful activation atomically creates/reactivates project_memberships for that worker, incrementing its version only on change. Never grant a tenant role or implicitly create membership for master/PTO/director. Explicit director project-membership endpoint supports those roles. Assignment revocation revokes active crew participation with version bumps; retain project membership and all history. Historical admissionCheckId nullable for legacy rows, currentAdmission eligible:false with no_check; no migration-generated passes.

GET /projects/:p/crews paged; GET /projects/:p/crews/:c → {id,projectId,name,version,members:[M]}; POST /projects/:p/crews {requestId,name} → {id,projectId,name,version}. M={employeeId,status,version,currentAdmission}. PUT /projects/:p/crews/:c/members/:e {requestId,expectedVersion,status:'active'|'revoked'} → M; expectedVersion=0 means create only. Detail/list members respect employee visibility; worker sees only own participation. Inclusion requires active assignment and valid current admission referenced by that assignment. One active crew per employee/project enforced in SQL; changing crew requires explicit revoke then activate. Cross-project crew IDs return 404. Archived employees cannot be activated, checked or included. Archiving revokes active assignments and crew members atomically, with version bumps and audit details; historical records stay readable under existing visibility.
</contract>

<eligibility_and_transaction_rules>
Admission is current only when employee active, assignment points to a passed check for the same employee/project/family, that check is the latest attempt (including failed attempts), its templateVersion is the family's current version, and every required code currently resolves to the EXACT qualification id+version stored in its evidence, still active and valid on tenant civil date. validUntil is inclusive; null means no expiry. New check sequence is allocated under employee row lock, so latest is deterministic, never timestamp-only. A later failed attempt blocks older passed IDs. Changing/revoking/replacing required evidence blocks prior checks until a fresh check; unrelated qualification edits do not invalidate. Every read returning currentAdmission computes it now and preserves immutable passed snapshots; no background pass rewriting. Assignment/crew activation must run this same evaluator inside its transaction.

Use existing withTenant. Authorize active director and referenced resources on every command, including receipt replay; replay checks current access, then returns original result without re-running mutable business eligibility. Canonical hash includes method+path identifiers and normalized complete payload except requestId, including expectedVersion; tenant/actor/requestId composite key. Reserve receipt via INSERT ON CONFLICT DO NOTHING in the same transaction before business changes; conflict waits for committed receipt, then hash-check and return stored body/status. Rollback removes reservation/business/audit together. Do not copy legacy check-then-write client_events implementation. No new framework or command bus.

Use one lock order for every command: receipt reservation → project rows ordered by UUID (when the command has a project/template) → existing employee rows ordered by UUID → tenant membership rows ordered by user UUID → employee_project_assignments → project_memberships → crew_members, with each class ordered by its composite primary key. Skip unused classes; never acquire an earlier class after a later one. Employee create/link edit uses employee → tenant membership (create has no existing employee row); assignment/check/crew activation uses project → employee → membership; explicit project-membership update uses project → membership. Lock/revalidate active linked/target tenant membership before writing; check active director authorization again inside the transaction without taking a membership lock ahead of project/employee locks. Archive locks its employee and then dependent rows, never project rows; link edit locks old/new membership rows in sorted order. Qualification writes lock employee; template publication locks project. Concurrent link-edit versus assignment, archive versus activation, and explicit versus implicit membership tests must demonstrate no deadlock and no stale-link grant. Template publication uses project lock; activation takes project lock so an intervening template version cannot pass a stale test. Receipt reservation precedes locks. ExpectedVersion compare-and-update is inside transaction; membership/assignment/member insertion requires version0 and conflicts return409. SQL unique constraints provide the final crew-conflict guard. Audit records before/after and command requestId for every changed entity, including implicit worker membership and cascading archive/revoke; exclude secrets. Immutable check snapshots retain template/evidence/actor/time and cannot be updated through API.
</eligibility_and_transaction_rules>

<tasks>
<task type="auto">
  <name>1. Prove employee and qualification commands vertically over real HTTP/PG</name>
  <files>apps/api/sql/003_people_admission.sql, apps/api/src/people.service.ts, apps/api/src/people.controller.ts, apps/api/src/people-input.ts, apps/api/src/director-api.service.ts, apps/api/src/app.module.ts, apps/api/test/people-api.test.ts</files>
  <action>Add only the additive migration and small service/controller/input modules. Expose existing DirectorApiService scoped existence/visibility helpers for internal reuse instead of duplicating ACL or widening scope; retain old read shapes plus employee version/status. Register guarded routes through AppModule. Implement E/Q contract and command receipts first. Migration adds employee status/version, nullable same-tenant linked-user membership FK after checking legacy data (fail descriptively on invalid links, never silently rewrite), versions to existing membership/assignment rows, nullable assignment admission check ID (add its FK only in migration004 after the check table exists), and audit_log.details jsonb. Add qualifications with composite tenant FKs, unique active employee/code and versions; receipt table keyed tenant/actor/requestId with operation/hash/status/result and tenant/user membership FK. Use FORCE RLS on new tables with existing app_tenant policy; grant only SELECT/INSERT/UPDATE needed, no DELETE on new personnel tables; immutable checks/template-version rows receive SELECT/INSERT only; mutable template heads receive SELECT/INSERT/UPDATE. Receipts require SELECT/INSERT plus column-scoped UPDATE(status,result) to complete the reserved result (include any additional completion column explicitly), never UPDATE of tenant/actor/requestId/operation/hash and never DELETE. Audit remains append-only on this command path; no UPDATE/DELETE grant expansion. Write test fixture with two tenants/projects and actual logins; prove create→read→edit→qualification, scoped denial and archive. Before finishing this task, run real HTTP tracer plus concurrent same-key create and stale edit; one business row and one audit effect, no secret/document-number registry fields. Task1 applies migration003 as its tracer gate; task2 therefore adds remaining schema and the assignment-check FK in migration004. Never modify a ledger-applied migration. No seed/reset of UI DB.</action>
  <verify><automated>HELIOS_DB_PORT=54339 DATABASE_URL=postgres://helios_app:helios_app@127.0.0.1:54339/helios ADMIN_DATABASE_URL=postgres://helios:helios@127.0.0.1:54339/helios corepack pnpm db:migrate && HELIOS_DB_PORT=54339 DATABASE_URL=postgres://helios_app:helios_app@127.0.0.1:54339/helios ADMIN_DATABASE_URL=postgres://helios:helios@127.0.0.1:54339/helios corepack pnpm --filter @helios/api exec tsx --test test/people-api.test.ts</automated></verify>
  <done>Authenticated HTTP creates/updates a visible employee and qualification, forbidden/foreign links fail, concurrent replay is single-effect and stale versions409 with atomic receipts/audit.</done>
</task>

<task type="auto">
  <name>2. Complete immutable admission, safe assignments and project crews</name>
  <files>apps/api/sql/004_admission_crews.sql, apps/api/src/people.service.ts, apps/api/src/people.controller.ts, apps/api/src/people-input.ts, apps/api/test/people-api.test.ts</files>
  <action>Depends on task1's proven command/ACL path. Add the remaining schema with project admission-template family/head, immutable template versions, employee admission checks with unique tenant/employee/sequence, crews and crew_members; extend assignments with same-tenant/same-employee/same-project check FK and retain nullable legacy lineage. Use tenant/project/crew composite FK and partial unique active crew membership on tenant/project/employee. Template head/family is unique per project; code immutable. All new tables FORCE RLS and limited grants, indexes on scoped lookup/history. Implement all remaining contract routes and one evaluator using the exact rules above. Keep immutable snapshots rather than joining mutable template text into historical checks. Serialize template publish/check/activation and qualification changes as specified; assignment/crew writes store actual check lineage and never infer admission from existing rows/tasks. Historical assignment reads dynamically expose invalidated currentAdmission after failed check, expiry, template revision, evidence mutation or archive; old pass remains unchanged in history. Implement director-only project membership with role derived from active tenant membership and automatic membership only for linked workers. Revoke crew participation on assignment revoke/archive. Expand real HTTP tests to complete create→qualification→template→check→assignment→worker login/project read→crew, then invalidate each prerequisite and prove rejection of new activations/inclusions and dynamic read eligibility. Test concurrent template updates, qualification-vs-activation, two crews, latest failed check versus old pass, equal-time attempt ordering, renewal/new evidence, inclusive expiry in a timezone distinct from UTC. Use SQL fixture clock inputs based on tenant date rather than flaky midnight assumptions.</action>
  <verify><automated>HELIOS_DB_PORT=54339 DATABASE_URL=postgres://helios_app:helios_app@127.0.0.1:54339/helios ADMIN_DATABASE_URL=postgres://helios:helios@127.0.0.1:54339/helios corepack pnpm db:migrate && HELIOS_DB_PORT=54339 DATABASE_URL=postgres://helios_app:helios_app@127.0.0.1:54339/helios ADMIN_DATABASE_URL=postgres://helios:helios@127.0.0.1:54339/helios corepack pnpm --filter @helios/api exec tsx --test test/people-api.test.ts</automated></verify>
  <done>Complete people flow works, worker sees its assigned project, latest failed/stale/expired/revoked evidence blocks eligibility and writes, concurrent operations preserve one crew/current version, immutable history and audits remain intact.</done>
</task>

<task type="auto">
  <name>3. Publish contract and run full compatibility/concurrency verification</name>
  <files>apps/api/openapi.json, docs/director-api.md, apps/api/test/people-api.test.ts, apps/api/test/director-api.test.ts, apps/api/test/foundation.test.ts</files>
  <action>Describe every route/body/status and named E/Q/T/C/A/M schema in OpenAPI, including strict body validation, expectedVersion0 semantics, read paging, role scope, latest-check ordering, currentAdmission versus historical passed, required evidence versions, civil-date expiry, automatic worker membership, revocations, replay and blocked legacy admission. Expand existing ten-operation assertions to cover method+path inventory, preserving prior operation coverage. Add concrete handoff examples for all steps and immutable prior-pass lineage/read scope; label phase02a, phase02b task readiness still pending and legacy task/sync limitations unchanged. Update old fixture cleanup order for new tenant children without weakening assertions; use admin only for own fixtures, never global truncate. Verify malformed JSON/fields/UUID/date, non-director writes, hidden project/employee reads, cross-tenant organizations/users/check/crew references, requestId same/changed operation and payload, parallel same/different keys and rollback leaving no receipt/audit/business row, stale versions, noncritical warnings, missing required answer, critical failure, missing/expired/revoked qualifications, latest failed attempt, template and evidence changes, archive/revoke and historical records, including explicit rejection of archived→active employee edit and activation after archive. Assert new table RLS through application role and migration second run ledger stability. Run new suite twice, full pnpm test and API tsc. Use54339 and loopback ephemeral test listener; do not reuse possibly stale API4327 process or touch54329/4317. Record exact results and limitations for executor SUMMARY/verification, without claiming unrun checks.</action>
  <verify><automated>HELIOS_DB_PORT=54339 DATABASE_URL=postgres://helios_app:helios_app@127.0.0.1:54339/helios ADMIN_DATABASE_URL=postgres://helios:helios@127.0.0.1:54339/helios corepack pnpm test && corepack pnpm --filter @helios/api exec tsc --noEmit</automated></verify>
  <done>New suite passes repeatedly, existing suites and tsc pass, migration repeat is safe, OpenAPI matches reachable HTTP contract, and handoff accurately marks phase02a boundaries.</done>
</task>
</tasks>

<verification>
Execute tasks sequentially because schema/service/test files overlap. Before commands confirm codex-api checkout and expected base ancestry; no main/cursor-ui/apps/web/packages/ui edits. Runtime DB connection must resolve to isolated54339 with its expected data_directory. If sandbox blocks loopback/PG, request authorized host execution rather than changing targets or weakening tests. Required evidence is actual HTTP+PG assertions, retained historical snapshots, receipt/audit row counts and full test/tsc output. Optional source refactor only when needed to share existing visibility. No external research or dependency change is needed (discovery level0: established Nest/pg patterns).
</verification>

<source_audit>
GOAL: ROADMAP02a people/admission/project crews → tasks1–3. REQ: subsequent people slice plus ACL-01/TEST-01/DEV-01 → tasks1–3; PEOPLE-02A is this increment's local trace label, not a claimed preexisting requirements ID. CONTEXT: authority/visibility and employee linking→1–2; requestId/version/audit/atomicity→1–3; qualifications/template/check/expiry/current evidence→1–2; project membership/assignment/crew/archive/history→2; real54339 tests/OpenAPI/compatibility→3. No RESEARCH.md exists and no research-specific obligations are inferred. Phase02b and other roadmap phases are explicit exclusions, not claimed covered. All locked context decisions are covered; no deferred full typed checklist/task readiness/offline capability enters implementation.
</source_audit>

<success_criteria>
All five must-have truths have real HTTP/PostgreSQL evidence; no client can forge admission, regain eligibility through an earlier pass, race receipt replay into duplicate writes or cross scope boundaries. Existing v1 consumers remain compatible. UI has a complete documented people contract, with phase02b and full-pilot work clearly pending.
</success_criteria>

<output>
After implementation create 261109-bkb-SUMMARY.md in this quick-task directory with changes, migration names, exact test commands/results, remaining limitations and next backend increment. Orchestrator owns STATE/verification/docs commits. Planner creates only this PLAN; no implementation, tests execution or commits in planning.
</output>
