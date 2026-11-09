# Task2 approval checkpoint — resume XLSX in fresh context

Status **incomplete Task2**, Task3 pending. Task1 remains committed and unchanged. Worktree `/Users/Gleb/Documents/ChatGPT/sites/helios-worktrees/codex-api`, branch `codex-api`, current source `4f95eef`, original base `8294b79`. No UI/main/deploy/API4327 restart; no dependencies added or changed. Parent owns canonical Brain, planning/SUMMARY/STATE and final runtime restart. This handoff is local/uncommitted.

## Commits and checks

- `0695183 test(261109-qu2): add exact time approval HTTP tracer` — actual authenticated RED404, fixture/login successful; small transcribed evidence in task2-approval-red.json.
- `4f95eef feat(261109-qu2): add revisioned exact day time approvals` —009, four routes, canonical source and16 approval tests.
- Initial009 apply and immediate repeat succeeded after explicit admin identity check: database/user helios, SQL port54339, data_directory exactly this worktree/.data/pg-54339. In-suite full migration ledger and exact head/revision row snapshots match after two further standard migrations.
- Final affected **56/56 = time16 + evidence17 + execution23**, `task2-approval-affected.log`.
- Full retained **117/117 = domain10 + API107** (old API91 +16 time), `task2-approval-regression.log`. The full run included the final exact-clock16th test. A following API tsc caught a test-only Actor fixture type lacking name/email; fixed and final affected56/API tsc passed. No behavioral source edits followed full regression.
- Final API `tsc --noEmit` and `git diff --check 8294b79` passed. Domain plain/fallback tsc belongs to Task3 and was not rerun here.
- Expected injected audit-error stack appears in logs; rollback test passed. One failed test cleanup ordering left two own fixture tenants; cleanup fixed and exactly those identified tenant IDs plus five own users removed after DB identity verification. No unrelated data reset/deletion.

Every migrate/test used:

```sh
h03b() { env DATABASE_URL=postgres://helios_app:helios_app@127.0.0.1:54339/helios ADMIN_DATABASE_URL=postgres://helios:helios@127.0.0.1:54339/helios HELIOS_DB_PORT=54339 API_PORT=4327 "$@"; }
h03b corepack pnpm db:migrate
h03b corepack pnpm db:migrate
h03b corepack pnpm --filter @helios/api exec tsx --test --test-concurrency=1 test/time-api.test.ts test/evidence-api.test.ts test/execution-api.test.ts
h03b corepack pnpm test
h03b corepack pnpm --filter @helios/api exec tsc --noEmit
git diff --check 8294b79
```

## Implemented, to reuse

`009_time_approvals.sql`: immutable SELECT/INSERT revisions, FORCE RLS, safe bigint version/previous chain, receipt uniqueness/FK, scoped deferred head→revision FK and narrow head version UPDATE. No reported03a mutation. Head is only inserted after valid first approval, under employee serialization; absence means version0.

Four protected routes in `time.controller.ts`: GET day, paged GET history(default50), POST approvals, POST revoke. Strict normalized UUID/day/query/body, canonical nonnegative integer strings parsed as BigInt, required correction reason, acknowledgment, safe version/hash checks. Director-only commands, historical granted master/PTO and current own worker reads via evidenceTimeScope. Receipt→project→employee→sorted membership/grant→head ordering; replay checks current director then returns original snapshot regardless of later versions/source. Fresh source/version after lock waits, atomic receipt/revision/head/audit rollback. Revoke appends a snapshot preserving source/confirmed values and prior revision attribution through history. GET exposes current/stale/revoked/unapproved, source/hash/recorded/future/dayLength/capturedAt/latest/version. Overrides expose null confirmedTaskAllocation; default uses source task totals.

`execution-read.ts` now exports exact SQL civilClipStart/End/Ms, used unchanged by03a and new source. Old03a outputs/regression retained.

`time-source.ts`: exact SQL clipped segment predicate includes positive intervals, closed zero markers within half-open civil day, and open intervals intersecting day up to captured server clock (including exactly just-opened0). It replays scoped shift interval-event ledger in numeric employee-version order; original payload task UUID normalized for matching. It matches recorded segments by shift/raw start/end/mode/task to ordered lifecycles, retains ordered zero markers and event identities including tenant+actor+request. Relevant event flag subset is delayed/future/geoTimeMismatch/suspicious, with carry-in/closing boundary governance; submit_volume and abovePlannedQuantity excluded. Canonical recursively sorted object keys, deterministic arrays, SHA256; source contains only clipped UTC endpoints/event instants, exact ms strings, civil bounds/timezone/day, IDs/modes/task/open/flags/totals. No global stream version or transient asOf/capturedAt/clock/raw outside-day endpoints in hash. Lifecycle mismatch fails409 time_source_inconsistent. timeSource optional clock supports a coherent shared snapshot; without it captures one server clock. Callers must hold current scope locks.

Real tests cover default/override/revoke/reapprove/history/replay, strict malformed input and huge integer rejection by exact day bound, optimistic one-winner/no loser receipts, closed zero/no-data/open/future, carry-in/equal-time transitions with same request UUID across actors, source flag corrections and irrelevant volume flags, raw out-of-day endpoint and server-time stability,23/25h/+1ms/03a equality, historical/current worker matrix, actual PG ACL wait gates, reverse director/employee admin arrival, exact audit rollback and migration/RLS/grants. Valid public03a APIs create admission, assignment, published task and late start/work/end/terminal report: relevant late shift stales approval, report/later-day/other-project do not. Both actual event→approval and approval→event PG queue orders proven without deadlock. Final test proves exactly just-opened0 and midnight half-open zero marker membership.

## Still required — no scope cuts

Task2 is **not complete**. No `/time/export.xlsx`, `time-xlsx.ts`, `inspect-time-xlsx.py`, XLSX writer/dependency or export tests exist yet. Fresh executor must read literal corrected PLAN/CONTEXT, implement export and every export invariant/test before marking Task2 done:

1. Inspect actual registry version/license/engines and official exact-version Node buffer/toBuffer API; allowed one exact pinned write-excel-file API dependency with `--ignore-scripts`, API package+lock only, no broad upgrades. Official URLs are CONTEXT. No lookup/install was done by this checkpoint.
2. Coherent complete captured snapshot: current director/granted manager only; strict inclusive civil range<=31days, max10000 recorded employee/day rows, same recorded predicate as timeSource incl zero/open markers. Export enumeration should share/extract that predicate instead of accidentally positive-only. Current approval required for every recorded row; bounded actionable409 missing/stale/revoked, explicit header-only empty range. Source/get/enumeration must use same captured timezone/server clock.
3. Project lock first, enumerate/capture sorted employees under employee locks, then sorted current memberships/grants and heads, consistent with03a/admin lock ordering; release all before render. Source may accept a shared clock. Current project lock blocks relevant source writes; sorted employee locks serialize other-project/admin interactions. Existing evidenceTimeScope handles sorted employees/member/grants and historical managers; avoid broad refactor.
4. Real typed String/XML-safe labels/reasons, source vs confirmed five categories with explicitly rounded6decimal hours plus raw ms, project/employee labels+IDs/date/timezone/reason/actor/revision/sourceHash/capturedAt/empty. No formula nodes from =,+,-,@ user labels. Actual XLSX safe headers/MIME/private no-store.
5. Fresh locked current export authority **after rendering** before response, with paused-render role/grant revocation denial. A new source event after capture during paused rendering must preserve and deliver the attributable captured snapshot; do not revalidate source hash after render or rewrite snapshot.
6. Python stdlib ZIP/XML parser invoked on actual HTTP response asserts worksheet relationships/cells/raw source/confirmed totals and typed malicious labels/no provisional leaks. Full export complete/missing/stale/revoked/empty/31days/10000rows/current ACL/race/zero cases per PLAN. Preserve all16 approval tests and old assertions.
7. Re-run exact Task2 verify and commit export/dependency separately. Task3 publishes actual old58+11=69 contract/docs and final regression/domain known baseline fallback; current old58 contract remains intentionally unchanged. No count fiction or complete03/pilot claim.
