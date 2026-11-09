# Backend state

Date: 2026-11-09
Branch: codex-api
Base: b2ddc9f
Current phase: 02b — daily task preparation, front readiness and safe publication.
Status: backend02b independently verified (6/6 must-haves) at source f2d63e2; ready for UI integration within its documented single-employee preparation scope. Next: phase03 managed execution.
UI worktree is independent. Avoid edits there and main.

## Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|---|---|---|---|
| 261109-azt | Versioned read API, explicit tenant/project ACL, real overview, OpenAPI and UI handoff; domain10 + API12 and repeat new9 passed | 2026-11-09 | 45a9b51 | quick/261109-azt-versioned-director-api-tenant-project-ac |
| 261109-bkb | People/qualifications, immutable admission/current evidence, assignment/crews; OpenAPI30; independently verified 5/5, domain10/API26 + people14 repeat + tsc passed | 2026-11-09 | f1717a4 | quick/261109-bkb-people-qualifications-admission-checks-c |
| 261109-cdb | Real catalogs/drafts, versioned front checks, atomic admission-gated publication, interval conflict checks and legacy fences; independently verified 6/6, domain10/API51 + tasks25 repeat + API tsc | 2026-11-09 | f2d63e2 | quick/261109-cdb-daily-task-drafts-readiness-and-safe-pub |

## Confirmed decisions

- Backend uses isolated PostgreSQL54339, `.data/pg-54339`, API4327. Original UI defaults retained.
- Workers require active project membership plus actual employee assignment for project/task reads; own employee profile stays available without assignment.
- Missing quality/downtime/ID metrics are explicit unavailable/null. Legacy write limitations remain documented.
- No UI edits, main merge, deployment or complete-pilot readiness claim. Next: UI integration and phase03 validated shifts/downtime/reports/offline/files.
- Backend02a uses durable atomic receipt/audit commands and ordered NO KEY UPDATE locks; current eligibility requires latest attempt/template and exact active qualification id/version on tenant civil date. Backend02b adds current+workDate evidence checks at publication. Legacy creation is retired (410), and legacy execution rejects all managed tasks before replay/effects; legacy fixture execution remains uncertified.
- API4327 started from f2d63e2; live health/OpenAPI53, seeded director login/projects/zones/work-types/tasks status filter, legacy create410 and logout smoke passed after independent verification. Isolated PG54339 retained.

## Backend02b implementation checkpoint — 2026-11-09

Quick261109-cdb Task1 completed at c7b119d (RED7d361f0): project catalogs, strict durable managed drafts, worker preparation isolation, additive Task response schema. Actual tasks9/9, unchanged people14/14, prior director9/9 and foundation3/3 passed; API tsc/diff-check exit0;005 migration and exact ledger/data repeat verified on PG54339 `.data/pg-54339`. PG process retained; API4327 was not restarted. SUMMARY status incomplete: Task2 front/readiness/lifecycle/publication/snapshots/races and Task3 legacy write fences/full contract/docs/regression still pending. No complete02b/pilot or independent-verifier claim.

## Backend02b implementation checkpoints2/3 — 2026-11-09

All three quick261109-cdb implementation tasks are complete. Task2 RED127d300/GREENb1b2c68 adds006 immutable front versions/attempts/publication, approval lifecycle, same-client personnel eligibility plus future workDate gate, ordered fresh ACL locks and serialized cross-project overlap. Tasks22/22 twice + unchanged people14/14 and API tsc passed. Task3 RED24dfb31/GREENf2d63e2 retires legacy create410, fences all managed execution before receipt replay/effects, preserves explicit legacy foundation rollback/job/replay assertions, and delivers53-operation OpenAPI (52v1 +1 deprecated create) and current docs. Final full pnpm test domain10/API51 and repeated tasks25 pass; API tsc/migration repeat/diff-check exit0. Planned plain domain tsc fails TS2688 due existing missing local types/node resolution; explicit existing-typeRoots fallback `corepack pnpm --filter @helios/domain exec tsc --noEmit --typeRoots ../../apps/api/node_modules/@types` passes without dependency/config changes. SUMMARY records exact deviation/races/rollback/grants/evidence.

Independent verification subsequently passed6/6; GSD verification.status=passed. Verifier independently repeated full domain10/API51, tasks25, API tsc and domain explicit-typeRoots fallback. Plain-domain failure and lack of independent fresh005/006 application are explicit limits. Parent started API4327 from verified source and live-smoked the new contract/read routes and retired create. Single-employee plans, yes/no front checks and RD metadata only; required material/ID/predecessor dependencies block until phase04. No complete-pilot claim.
