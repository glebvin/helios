---
phase: quick
plan: 261109-qu2
status: complete
completed_tasks: [1, 2, 3]
pending_tasks: []
independent_verification: passed
source_base: 8294b79fffe5567b26362a675c6cf72200ee8193
source_head: 7b3610a
branch: codex-api
---
# 03b-server — independently verified

All three implementation tasks are committed. Independent verification passed6/6 at21626a0 and the subsequent test-only fixture correction7b3610a was independently re-verified. This certifies the locked03b-server slice; physical-phone offline, complete Phase03 and the full pilot remain pending. No main/UI/apps/web/packages/ui/merge/deploy changes.

## Commits

| Commit | Task / result |
|---|---|
| 6a3420c | Task1 RED HTTP reservation tracer, intended404 vs201 |
| 316c850 | Task1 private evidence migration008, provider, six guarded routes |
| ea0daa9 | Task1 bounded binary buffering, durable directory promotion and full failure/race coverage |
| 0695183 | Task2 approval RED tracer |
| 4f95eef | Task2 immutable exact time source/approval/history/revoke migration009 and four routes |
| 7aa33d9 | Task2 real XLSX RED download tracer |
| 55821ef | Task2 coherent approved snapshot/export, typed XLSX writer, ZIP/XML tests and bounds |
| 21626a0 | Task3 additive strict OpenAPI69, actual HTTP contract assertions, docs and retained regression |
| 7b3610a | Test-only self-contained setup for filtered captured-XLSX late-event race; all assertions retained |

## Task1 — private evidence

Six operations implement reserve/list/metadata/raw PUT/download/immutable binding to an exact existing execution event or final report. Client file UUID, declared size1..8MiB, lower64hex SHA256, JPEG/PNG/PDF MIME and actual magic are verified. Strict bodies/query, current authority after real lock waits and after I/O, shared durable metadata receipts, separate idempotent raw PUT identity. Event identity is tenant+actor+request, exact scoped composite FKs; immutable file metadata/binding, FORCE RLS and narrow grants. Historical managers need no current target assignment/admission; workers require own current active link+grant+assignment.

Private local FS uses UUID paths,0700/0600, exclusive temp/write/fsync/no-clobber hard-link/fsync directories and cleanup. Network/storage I/O holds no project/employee locks. Storage promotion and PostgreSQL ready commit are distinct: post-storage DB rollback can leave private orphan; retry verifies/reuses bytes, never deletes a shared committed object. Download verifies digest/size and fresh authority, safe attachment/nosniff/CSP/no-store; missing/corrupt bytes503 without paths. Tests cover actual JPEG/PNG/PDF/max8MiB, raw framing/overflow/abort, retries/concurrency, write/sync/promotion/audit failures, orphan reuse, exact target FK/RLS/grants, both targets and actor collisions, real PG waits and paused-I/O revocations. Historical Task1 gate101=domain10/API91; evidence17. Current Task3 adds one contract test, evidence18.

## Task2 — revisioned hours and actual XLSX

Source uses shared03a exact civil-day clipping, zero-time recorded markers,23/25h bounds and ordered same-shift interval ledger. Canonical hash includes only relevant clipped IDs/modes/task/time/ms, zero markers, actor+request identity and interval-event flags; omits unrelated days/projects/reports/global stream version/transient capture clock. Closed recorded zero days may be approved; empty/open/future source blocks; suspicious flags require acknowledgment+reason. Immutable approval/revoke chain preserves original source vs confirmed BigInt totals and current pointer, same receipt/current-role behavior. Aggregate override never invents confirmed per-task allocation. Valid late03a events remain accepted and only relevant changed source stales approval.

XLSX export requires director or current project-granted master/PTO, never worker. Inclusive<=31day/10000 recorded employee/day bound uses same recorded predicate as source. All rows must have latest approved current sourceHash; any missing/stale/revoked row fails entire export409 with up to20 actionable identifiers. Empty range is explicit header-only. One coherent capture under project→sorted employees→memberships/grants→heads; locks released before rendering; fresh current authority after rendering. Later source changes do not replace the attributable capturedAt/hash/revision workbook. Exact raw source/confirmed ms plus hours half-up6decimals, typed XML-safe String labels, no formulas from =,+,-,@, actual ZIP/OOXML Time+Snapshot sheets. Python stdlib independently parses downloaded ZIP/XML, including actual10000-row workbook and10001st-zero-row rejection.

Writer exact write-excel-file4.1.1, MIT, Node>=18; registry/official docs and installed Node .toBuffer types inspected. API-only `--save-exact --ignore-scripts` installation; one transitive fflate0.8.3, no general upgrades or production parser. See task2-approval-HANDOFF.md / task2-xlsx-HANDOFF.md for actual checkpoint evidence and earlier fixture correction. Historical Task2 gate67=time27+evidence17+execution23; current time28 includes one contract test.

## Task3 — additive contract and delivery boundary

OpenAPI1.4.0 has69 operations=old58 unchanged+6 evidence+5 time. Compared parsed old paths **and every old schema** to source8294b79: all equal. Retained execution test still asserts exact old53+03a5 inventory58 independently, then exact added11 and unique69 operation IDs. Prior director/people/tasks assertions remain, only total counters advance58→69.

New strict models cover required/additionalProperties:false fields, UUID/hash/day/exact-ms patterns, both attachment oneOf forms, file metadata/state, canonical source segments/events/zero markers/tasks/totals, approval revisions/day/history, strict approve/revoke forms, real binary PUT/three download MIME variants/XLSX, status/error/headers and role/replay/limits semantics. Test-only contract-check.ts resolves schema references and validates real new-suite helper JSON successes/denials and binary responses against actual status/MIME/headers. Two focused contract tests cover valid/invalid forms, required fields, oneOf/media/error inventory and unauthenticated actual401. Existing low-level raw HTTP framing tests remain, with transport-level pre-routing responses documented honestly.

Task3 RED initially hit expired PG (infrastructure failure, not counted). Restored retained54339 via standard db:up, then actual authenticated reserve succeeded201 but contract checker failed on undocumented evidence path. task3-red.log contains real intended assertion. This contract/docs/test-only task has no production source change; no machine RED classifier claim is made. GREEN46=evidence18+time28; final full and affected repeat below. No dependency or production implementation changes in Task3.

Docs include reserve→PUT→attach and source→approve/correct/revoke→export sequences, exact replay/current authority, hash relevance, DST/zero/open behavior, correction allocation limit, coherent capture and post-render ACL, local FS orphan boundary, actual writer/license/check commands. Production S3/AV/backups/cleanup, phone queue/UI/03c, authority workflow/quality/material/ID04 and complete operational/pilot acceptance remain explicit follow-up; no payroll/signature/1C claims.

## Final checks actually run at Task3

Every migrate/test/typecheck used explicit isolated env, no defaults:

```sh
h03b() { env DATABASE_URL=postgres://helios_app:helios_app@127.0.0.1:54339/helios ADMIN_DATABASE_URL=postgres://helios:helios@127.0.0.1:54339/helios HELIOS_DB_PORT=54339 API_PORT=4327 "$@"; }
h03b corepack pnpm test
h03b corepack pnpm --filter @helios/api exec tsc --noEmit
h03b corepack pnpm --filter @helios/domain exec tsc --noEmit
h03b corepack pnpm --filter @helios/domain exec tsc --noEmit --typeRoots ../../apps/api/node_modules/@types
h03b corepack pnpm db:migrate
h03b corepack pnpm db:migrate
h03b corepack pnpm --filter @helios/api exec tsx --test --test-concurrency=1 test/evidence-api.test.ts test/time-api.test.ts test/execution-api.test.ts
git diff --check 8294b79
```

- Full retained regression **130/130=domain10+API120**, API39.9s,0 fail/skip; task3-full-regression.log.
- Affected repeat **69/69=evidence18+execution23+time28**,23.7s,0 fail/skip; task3-affected-repeat.log.
- API tsc exit0; task3-api-tsc.log. Existing explicit-typeRoots domain fallback exit0; task3-domain-fallback.log.
- Plain domain tsc intentionally separately run: **exit1 TS2688 missing local types/node**, pre-existing; task3-domain-plain.log. No dependency/config fix or false green claim.
- Standard migration twice schema ready; tests independently compare exact ledger/data repeats for008/009. Initial migration applications were proven in earlier checkpoints, not newly re-applied to fresh DB here.
- `git diff --check 8294b79` exit0; parsed old operation/schema comparison passed.
- Each suite before-hook checks actual database helios/admin user helios/SQL port54339 and data_directory ends codex-api/.data/pg-54339 before fixture writes. Standard retained PG restored with host escalation only, session55458/PID41373; no reset/manualpid removal. API4327 never restarted. Temporary test roots/listeners cleaned by suites.

## Independent gate and live runtime closure

Fresh verifier traced actual SQL/storage/scope/source/approval/writer/controller wiring and independently repeated full130/130 at21626a0, APItsc and domain explicit-typeRoots fallback; plain domainTS2688 separately reproduced. Old58 operations and every old schema compared equal with8294b79. Generic key-link scanner returned0/4 because of semantic/.js imports; all four links were manually and behaviorally traced, not counted as an automated pass.

Verifier found one filtered test relied on preceding stream/admission fixtures. Narrow test-only7b3610a adds11 setup lines within that race without changing production/assertions/common before-hook. Executor reproduced RED, then filtered1/1 and full time28/28 passed; verifier independently repeated filtered1/1 and reviewed the unchanged production diff. The prior isolation warning is resolved. No repeat of the full130 after test-only fix was needed; no production behavior changed. VERIFICATION reports passed6/6 at the resulting fingerprint.

Parent started API4327 from7b3610a, Node49890/session83065, with retained PG54339. Live smoke succeeded: health200, spec69, director login201/me200, evidence list200, no-recorded-time day/history200, actual header-only XLSX200, unauthenticated401, strict-query400 and logout201. Download4315bytes was parsed independently with Python ZIP/XML (Time headers and Snapshot empty=true). No evidence/time business data were created by this read/export smoke. Runtime script is /private/tmp/helios03b-live-smoke.mts; downloaded workbook /private/tmp/helios03b-live-empty.xlsx.

## Limits and handoff

No known blocking stubs or skipped tests introduced. Threat surface is exactly locked plan: private binaries, scoped approvals and bounded XLSX; Task3 adds no runtime surface. Plain domain TS2688 remains an explicit baseline limitation. Physical phones, durable client queue, S3/AV/orphan operations, backups/restore, UX/load and full pilot acceptance are not certified here. Initial fresh008/009 application was not independently repeated, though retained data/migrations and actual RLS/FK/immutability behavior were verified. Whole-pilot requirements are not newly marked complete. Next03c integrates the durable client queue/UI and physical devices, then04/05 continue the remaining pilot.

## Self-Check: PASSED

Implementation files, tests, docs and all nine commits above exist; all are ancestors of source HEAD7b3610a. Worktree is codex-api. Independent acceptance is recorded in sibling VERIFICATION; parent owns the final planning/state commit.
