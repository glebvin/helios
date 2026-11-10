# Context — backend 02a: people/admission/crews

Date: 2026-11-09. Owner requested continuing backend under GSD while UI independent.
Base HEAD: 22588a9. Work only codex-api; do not edit main/cursor-ui/apps/web/packages/ui.
Read customer pilot 19.2 items1–2 and current first-slice handoff.

## Scope decisions for this increment
A coherent people flow, not all roadmap phase02: create/update employee, qualifications,
versioned admission templates/checks, project assignment and crews. Daily task write/readiness
is the next increment. Keep existing v1 fields/operations compatible; additive fields allowed.
No new runtime dependency, external integration, frontend, upload or physical-offline claim.

## Authority and visibility
- Initial personnel writes restricted to active tenant director (current implemented roles).
- Director may assign project membership to an existing active tenant member; role comes
  from tenant membership, never request data. No account creation/invitation in this scope.
- Reuse explicit project/employee visibility for reads: worker own records, master/PTO
  their assigned projects, director tenant. No tenant/global fallback for unassigned people.
- Creating an employee is not creating a login; optional linked user must be active member
  of the same tenant. New input must not link arbitrary global users or foreign organization.
- Reads of qualifications/checks respect visibility; registries do not expose document numbers.

## Writes, concurrency and audit
- New business write commands require UUID requestId in JSON body. Same actor/tenant/key
  and same operation/payload replay original result, changed command/payload =>409.
- Receipts, business changes and audit are atomic in one PG transaction; no check-then-write
  race. Authorize each replay before returning cached result.
- expectedVersion for updates/revocations; stale version=>409, no silent overwrite.
- Append audit details before/after without passwords/tokens; immutable check snapshots.
- Archive/revoke instead of physical deletion; no deletes of historical personnel records.

## Data and admission
- Employees keep existing columns and gain version/archive status as needed.
- Qualifications: code/title/documentReference metadata, validUntil date nullable,
  active/revoked, version. Store historical/expired qualifications; they cannot satisfy admission.
- Admission templates versioned, with code/title, yes/no items (id/label/critical),
  required qualification codes. This increment supports yes/no admission checks only;
  full typed/photo/measurement production checklists remain later.
- Admission check stores exact template/version, answers, qualification evidence, actor/time,
  computed pass/fail and reasons. Client cannot supply trusted passed status.
- Validate required answers/no unknown or duplicate items. A false critical answer blocks;
  noncritical false is recorded warning, not an automatic block. Missing/expired/revoked
  required qualifications block. Time evaluated by tenant civil date; validUntil inclusive.
- Assignment activation and crew inclusion recheck current admission, latest template version,
  current qualifications/expiry, employee not archived. Serialise qualification changes and
  admission/assignment on employee row (or equivalent proven transactional guard).
- New check or new template version must not silently overwrite earlier history.
- Changing required qualification evidence must invalidate eligibility until rechecked;
  choose and document precise current-evidence/version rules. No pre-existing worker
  backfill as automatically admitted. Preserve existing assignments but don't pretend
  they passed admission; new write activation requires actual valid evidence.

## Assignments/crews
- Employee-project assignment refers only to same-tenant IDs, active/revoked with version.
- Explicit project membership management endpoint for existing active tenant users.
- For a linked active worker, activating employee assignment may atomically grant its
  project membership; document behavior. Never auto-grant director/master/PTO role.
- Revoked assignment removes active crew participation on that project without deleting history.
  Worker visibility already also checks active assignment; keep project membership history.
- Crews are project-bound; create/list/detail and activate/revoke member.
- One active crew per employee per project; reject cross-project crew and foreign-tenant IDs.
- Crew inclusion requires active project assignment and valid current admission.
- All-or-nothing writes and same-tenant foreign keys, RLS, indexes; no broad grants.

## Verification
Real HTTP/PostgreSQL tests on54339, existing suites retained. Test complete flow including
worker login seeing assigned project, roles/foreign tenant/project, malformed body/date/UUID,
duplicate/replayed/changed/concurrent requestId, stale versions/concurrent updates, expiry
by tenant date, qualification revocation, failed/noncritical check, template update,
crew conflicts/cross-project, archive/revoke and preserved audit/check history.
Update old test fixture teardown for new tables where needed, not weaken assertions.
OpenAPI operations/response shapes updated; existing10-op inventory assertions expanded.
Repeat new suite/full tests, tsc; no production/load/phone claims.

## Runtime
Existing PG54339 is isolated .data/pg-54339; API4327 process32542 may be running old source.
Never touch UI PG54329/API4317. New migrations only isolated54339 with ADMIN_DATABASE_URL.
Tests loopback/PG may require approved host execution. No main merge/deploy.
