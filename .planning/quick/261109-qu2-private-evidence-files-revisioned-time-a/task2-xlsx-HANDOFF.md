# Task2 completed — XLSX checkpoint, Task3 remains

Worktree `/Users/Gleb/Documents/ChatGPT/sites/helios-worktrees/codex-api`, branch `codex-api`, HEAD `55821ef`; original base `8294b79`. Task1 and approval commits remain unchanged. No UI/main/worktree/merge/deploy/API4327 restart. Canonical Brain and planning SUMMARY/STATE updates belong to parent. This handoff and logs are uncommitted planning evidence.

## New commits and actual checks

- `7aa33d9 test(261109-qu2): add actual XLSX download tracer`: authenticated actual HTTP empty export returned404 against expected200; fixture/login/DB identity succeeded; exit1, one failing test. Existing approval RED/GREEN remains0695183/4f95eef.
- `55821ef feat(261109-qu2): export coherent approved time XLSX snapshots`: export route, shared recorded predicate/range input/current-role helper, typed writer, Python stdlib ZIP/XML inspector,11 additional tests; exact writer+lock.
- Full time suite **27/27 = prior16 approval +11 XLSX**,22.3s, `task2-xlsx-time.log`.
- Task2 gate: standard migration twice `schema ready`, affected **67/67 = time27 + evidence17 + execution23**,33.3s, `task2-xlsx-affected.log`; API `tsc --noEmit` and `git diff --check 8294b79` exit0. The migration idempotency tests compare exact ledger/data again internally.
- Full repository regression was **not rerun after XLSX**: Task3 requires it after final contract/docs. Prior approval checkpoint full117 (domain10/API107) is historical evidence, not final XLSX count. New expected baseline before any Task3 test additions:128 total = domain10 + API118.

All database/migrate/test commands used exact env:

```sh
h03b() { env DATABASE_URL=postgres://helios_app:helios_app@127.0.0.1:54339/helios ADMIN_DATABASE_URL=postgres://helios:helios@127.0.0.1:54339/helios HELIOS_DB_PORT=54339 API_PORT=4327 "$@"; }
h03b corepack pnpm --filter @helios/api exec tsx --test --test-concurrency=1 --test-name-pattern='XLSX tracer' test/time-api.test.ts
h03b corepack pnpm --filter @helios/api exec tsx --test --test-concurrency=1 test/time-api.test.ts
h03b corepack pnpm db:migrate
h03b corepack pnpm db:migrate
h03b corepack pnpm --filter @helios/api exec tsx --test --test-concurrency=1 test/time-api.test.ts test/evidence-api.test.ts test/execution-api.test.ts
h03b corepack pnpm --filter @helios/api exec tsc --noEmit
git diff --check 8294b79
```

Every test before-hook verifies admin DB `helios`, user `helios`, SQL port54339, data_directory ends `codex-api/.data/pg-54339`. Retained PG was already running and was not reset/restarted. Host escalation was needed for local network HTTP/PG and git/package operations; no approval rejection. API4327 untouched.

## Exact dependency evidence

Before install inspected registry metadata via `corepack pnpm view write-excel-file version license engines dist.integrity --json`: actual version **4.1.1**, **MIT**, **Node >=18**, integrity `sha512-MUnCnNtQrcZek832ZcU24uU0rSphFmKPD1DvIjXOlygVb93CV7Tme6H3jUTkxsMmjB2W7HIzERzjqTi5kui71A==`.

Read official https://github.com/catamphetamine/write-excel-file (Node import/toBuffer and typed String), https://catamphetamine.gitlab.io/write-excel-file/, and official master package.json (reports4.1.1) https://raw.githubusercontent.com/catamphetamine/write-excel-file/master/package.json. The attemptedv4.1.1 README tag URL404; no claim that nonexistent tag was checked. After exact install inspected actual installed4.1.1 README, package/license and `node/{index,ReturnType}.d.ts`: API is `writeExcelFile(sheetData).toBuffer()` or multi-sheet objects then `.toBuffer()`, Promise<Buffer>. Runtime Node24 meets engines.

Authorized command used exactly:

```sh
corepack pnpm --filter @helios/api add --save-exact --ignore-scripts write-excel-file@4.1.1
```

Only API package and pnpm lock changed: one direct exact writer, unavoidable `fflate@0.8.3` transitive (writer declares^0.8.2). No other dependency churn/upgrade/parser. Python3 stdlib `zipfile`, `xml.etree`, `json`, `posixpath` independently reads downloads in tests.

## Implemented export semantics

`GET /api/v1/projects/:p/time/export.xlsx?from=YYYY-MM-DD&to=YYYY-MM-DD` only director or current granted master/PTO; worker403 even empty range. Strict required strings/no extra/repeated query fields; valid ordered inclusive civil range<=31days. Real XLSX MIME, fixed validated ASCII attachment filename, private/no-store, nosniff.

Under project NO KEY UPDATE, capture one server clock+tenant timezone and enumerate distinct employee/day rows using extracted `recordedTimePredicate`, identical to timeSource/approval: positive clipped, closed in-day zero, relevant open incl just-opened0. LIMIT10001 then reject422 `time_export_row_limit` if>10000. Sorted employees, sorted actor/linked memberships and project grants through evidenceTimeScope; then sorted employee/day heads. Capture current labels, exact source and immutable latest revision under those locks. Require every recorded row exact current approved hash; missing/stale/revoked409. Error string `time_export_incomplete:` plus JSON array of up to20 `{employeeId,day,status}`; fail entire export, no silent row filtering. Stop once20 actionable conflicts collected because entire request already fails. Empty is explicitly header-only `Time` sheet with `Snapshot` explanation/empty=true.

All locks release before `TimeXlsx.render`. Immediately after ZIP rendering a fresh locked transaction rechecks only current director/granted-manager role/status/grant. It does **not** revalidate resource source or swap revisions. New accepted source events after capture may stale current state while downloadable bytes remain attributable to capturedAt/hash/revision. Post-render revoked authority returns JSON denial, never bytes.

`Time` sheet includes project/employee labels+IDs, civil date/timezone, version/hash/capturedAt, approving actor/request/time, override/reason, source and confirmed five categories as exact integer-ms String cells plus Number hours. Hours use BigInt half-up six decimal rounding and explicit0.000000 number format; raw ms authoritative. Labels/reasons/IDs are explicit String cells; remove XML1.0-illegal controls/lone surrogates/FFFE/FFFF; writer escapes XML. Literal=,+,-,@ retain String type, no formulas. `Snapshot` records range/project/timezone/clock/count/empty/explanation/rounding and no confirmed per-task allocation for overrides. No provisional volume/report values exported.

## Added actual tests

Independent downloaded ZIP/XML parser verifies ZIP CRC, XML parseability, workbook relationships and both sheets,34 columns, every row String/Number/Boolean types, six decimal hours format, and no formula nodes anywhere. Tests check precise source and confirmed values, identities/hash/revision/actor/request/approvedAt/capturedAt/timezone and no provisional leakage.

Coverage: header-only empty and safe HTTP headers; inclusive31vs32days, missing/reversed/invalid/duplicate/unknown query; zero recorded day and1ms source vs manual correction (rounding0,1,1.000001,0.000001); all malicious=,+,-,@ labels and XML controls/entities; director/master/PTO actual exports and archived/unlinked/unassigned historical employee; worker/foreign/project denial. Missing/stale/revoked/open source and relevant flags reject whole range. Actual PG role/status/grant wait graph gates reread current authority. Four paused real renders allow role/status/grant updates to finish under1s lock_timeout and then deny bytes. Valid03a start/end after capture during paused render accepted, current source becomes stale, old attributed workbook delivered; next export409. Actual event→export and export→event PG queues both proven, no deadlock. DST Europe/Berlin23/25h exported exact ms/hours.

Boundary test constructs actual FK-scoped323 employees and source ledgers spanning10000 employee/day rows, confirms incomplete409 has20 identifiers, spot-checks explicit fixture canonical sources via GET, inserts10000 immutable approved revisions/receipts/heads, downloads and independently parses real **10000-row XLSX**, verifies unique employee/day set, every hash/raw total and one captured clock; adding10001st closed zero-duration row rejects422. This is actual HTTP workbook testing, not a mocked renderer/count. Boundary test took15.3s standalone/18.6s affected.

## Corrections during verification

Initial GREEN query had unquoted SQL `day` alias; corrected before successful tracer. First broad run reached23 passing cases then a test intentionally left February source open, which correctly made November export409 before paused-render entry; this was a fixture cleanup bug, not product failure. Stopped only that stalled test child, verified exact54339 identity, identified and removed exactly its two fixture tenants/five generated evidence.test users (no unrelated data), closed the intentionally open fixture with matching ledger close, and added fail-fast paused-render entry race against early HTTP completion. Subsequent complete27 and affected67 passed. Expected injected time-audit error stack is part of passing rollback test.

## Task3 remains, fresh context recommended

Read literal CONTEXT/PLAN Task3 and current STATE/PROJECT/REQUIREMENTS. Current OpenAPI intentionally still58; route implementation now adds exactly11 (six evidence, four time reads/commands, one XLSX). Publish **69=old58+new11**, preserving exact prior operation inventory and all assertions. Strict required/additionalProperties:false models, UUID/hash/day/integer-ms patterns, attachment oneOf, complete actual file/source/revision/history/binary/error/status schemas and role/replay/conflict docs. Contract tests must resolve every $ref and validate HTTP successes/denials/binary models against actual schemas. Existing API filter returns `{error:string}`; export actionable identifiers are inside that error string, document actual representation.

Docs need real reservation/PUT/attach/approve/revoke/export examples, shared command-vs-PUT identity, source relevance/flags/correction semantics, captured snapshot and post-render current ACL, writer exact4.1.1 MIT/source/command, FS crash/private orphan reuse limits. Production S3/AV/backups/cleanup pending; no payroll/signature/1C/full03/pilot claim;03c UI/queue/phone and04 pending.

Required final Task3 gate per PLAN: full retained `h03b corepack pnpm test`, API tsc, explicit domain fallback `tsc --noEmit --typeRoots ../../apps/api/node_modules/@types`, affected evidence/time/execution repeat, diffcheck8294b79. Separately run/report known plain domainTS2688; do not fix via dependencies. No API4327 restart until parent independent verifier. Commit only final contract/docs/test changes; parent owns canonical Brain and planning/SUMMARY/STATE final state.
