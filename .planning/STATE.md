# Backend state

Date: 2026-11-09
Branch: codex-api
Base: b2ddc9f
Current phase: 03a — server-managed shifts, time segments, provisional volumes and ordered event ingestion.
Status: backend03a independently verified (6/6 must-haves) at source cfcfcf2. Next: 03b browser queue/files/photos/hour approval and physical-phone verification; Phase03 is not complete.
UI worktree is independent. Avoid edits there and main.

## Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|---|---|---|---|
| 261109-azt | Versioned read API, explicit tenant/project ACL, real overview, OpenAPI and UI handoff; domain10 + API12 and repeat new9 passed | 2026-11-09 | 45a9b51 | quick/261109-azt-versioned-director-api-tenant-project-ac |
| 261109-bkb | People/qualifications, immutable admission/current evidence, assignment/crews; OpenAPI30; independently verified 5/5, domain10/API26 + people14 repeat + tsc passed | 2026-11-09 | f1717a4 | quick/261109-bkb-people-qualifications-admission-checks-c |
| 261109-cdb | Real catalogs/drafts, versioned front checks, atomic admission-gated publication, interval conflict checks and legacy fences; independently verified 6/6, domain10/API51 + tasks25 repeat + API tsc | 2026-11-09 | f2d63e2 | quick/261109-cdb-daily-task-drafts-readiness-and-safe-pub |
| 261109-nqz | Managed execution events/shifts/segments/final provisional volumes, current authority and real races, exact day/DST reads and OpenAPI58; independently verified 6/6, domain10/API74 + execution23 repeat + API tsc | 2026-11-09 | cfcfcf2 | quick/261109-nqz-managed-task-execution-shifts-downtime-v |

## Confirmed decisions

- Backend uses isolated PostgreSQL54339, `.data/pg-54339`, API4327. Original UI defaults retained.
- Workers require active project membership plus actual employee assignment for project/task reads; own employee profile stays available without assignment.
- Missing quality/downtime/ID metrics are explicit unavailable/null. Legacy write limitations remain documented.
- No UI edits, main merge, deployment or complete-pilot readiness claim. Next: UI integration and03b durable browser queue, files/photos, hour approval and physical-phone testing.
- Backend02a uses durable atomic receipt/audit commands and ordered NO KEY UPDATE locks; current eligibility requires latest attempt/template and exact active qualification id/version on tenant civil date. Backend02b adds current+workDate evidence checks at publication. Legacy creation is retired (410), and legacy execution rejects all managed tasks before replay/effects; legacy fixture execution remains uncertified.
- API4327 started from cfcfcf2; live health/OpenAPI58, seeded director login/projects/execution shifts/reports, additive provisional exact-string overview, malformed empty batch400 and logout smoke passed after independent verification. Isolated PG54339 retained.
- 03a execution uses separate presence/work/break/downtime intervals, shared durable receipts, provisional final task/shift volume and immutable event ledger. All reported time/volume stays unapproved; no complete client offline/files/quality acceptance claim. Plain domain tsc retains baselineTS2688; explicit existing-typeRoots fallback passes.

## Backend02b implementation checkpoint — 2026-11-09

Quick261109-cdb Task1 completed at c7b119d (RED7d361f0): project catalogs, strict durable managed drafts, worker preparation isolation, additive Task response schema. Actual tasks9/9, unchanged people14/14, prior director9/9 and foundation3/3 passed; API tsc/diff-check exit0;005 migration and exact ledger/data repeat verified on PG54339 `.data/pg-54339`. PG process retained; API4327 was not restarted. SUMMARY status incomplete: Task2 front/readiness/lifecycle/publication/snapshots/races and Task3 legacy write fences/full contract/docs/regression still pending. No complete02b/pilot or independent-verifier claim.

## Backend02b implementation checkpoints2/3 — 2026-11-09

All three quick261109-cdb implementation tasks are complete. Task2 RED127d300/GREENb1b2c68 adds006 immutable front versions/attempts/publication, approval lifecycle, same-client personnel eligibility plus future workDate gate, ordered fresh ACL locks and serialized cross-project overlap. Tasks22/22 twice + unchanged people14/14 and API tsc passed. Task3 RED24dfb31/GREENf2d63e2 retires legacy create410, fences all managed execution before receipt replay/effects, preserves explicit legacy foundation rollback/job/replay assertions, and delivers53-operation OpenAPI (52v1 +1 deprecated create) and current docs. Final full pnpm test domain10/API51 and repeated tasks25 pass; API tsc/migration repeat/diff-check exit0. Planned plain domain tsc fails TS2688 due existing missing local types/node resolution; explicit existing-typeRoots fallback `corepack pnpm --filter @helios/domain exec tsc --noEmit --typeRoots ../../apps/api/node_modules/@types` passes without dependency/config changes. SUMMARY records exact deviation/races/rollback/grants/evidence.

Independent verification subsequently passed6/6; GSD verification.status=passed. Verifier independently repeated full domain10/API51, tasks25, API tsc and domain explicit-typeRoots fallback. Plain-domain failure and lack of independent fresh005/006 application are explicit limits. Parent started API4327 from verified source and live-smoked the new contract/read routes and retired create. Single-employee plans, yes/no front checks and RD metadata only; required material/ID/predecessor dependencies block until phase04. No complete-pilot claim.


## Backend03a implementation checkpoints1–2 — 2026-11-09

Quick261109-nqz remains incomplete2/3. Task1 committed81d27f0 (managed execution atomic event tracer/schema/strict batch); Task2 committed5615f1f (fresh target role compatibility and archived-worker authority fixes, real PG-gated race/ACL/replay coverage). Planned affected regression56/56=execution17+people14+tasks25; final execution17+foundation3=20/20 and API tsc passed. Migration007 apply/repeat plus exact row/data repeat remain verified through retained tests. PG54339 PID43410 retained; API4327 not restarted. Parent owns independent certification/canonical Brain. Task3 scoped reads/exact civil day+DST totals/overview/OpenAPI58/docs/full regression remains pending; requirements not marked complete. SUMMARY status incomplete and planning/state uncommitted for continuation.


## Backend03a implementation checkpoint3 — 2026-11-09

All three quick261109-nqz implementation tasks are committed:81d27f0,5615f1f,cfcfcf2. Task3 adds four current-scoped paged reads, exact decimal-string civil-day/DST/asOf time and per-task totals, report occurred-day/unit grouping, separate managedExecution overview and strict58-operation contract/docs. Final full h03 regression domain10/API74, execution23 repeat, API tsc and domain explicit-typeRoots fallback passed; plain domain tsc retains existing TS2688. Old53 path inventory/assertions, foundation jobs/rollback/replay, people/task assertions and managed legacy fences retained. PG54339 PID43410 retained; API4327 not started. Independent verification, requirements certification, parent planning/Brain closure and any subsequent API restart are pending.03b queue/files/hours and04 acceptance remain unfinished; no complete03/pilot claim.

## Backend03a independent verification and runtime closure — 2026-11-09

The preceding dated checkpoint descriptions are historical. Independent verifier passed6/6 at source cfcfcf2: full domain10/API74, execution23 repeat, API tsc, explicit-typeRoots domain fallback and base diff-check. Plain domainTS2688 and lack of independent initial007 application remain explicit limits. The generic link detector misses semantic/.js imports; all four links were manually/runtime traced in VERIFICATION. PG restored through standard db:up only, with exact54339/data_directory checked before writes. Parent started API4327 and live-smoked health/OpenAPI58, execution reads/provisional overview and invalid-batch rejection. Source/worktree remains isolated; managed task plan/snapshots unchanged and legacy execution fences retained. Remaining03b/04/05 work is not certified by03a.
