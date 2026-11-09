# Backend state

Date: 2026-11-09
Branch: codex-api
Base: b2ddc9f
Current phase: 02a — personnel, admission and project/crew assignments.
Status: first v1 read slice independently verified (6/6 must-haves); backend02a independently verified (5/5 must-haves), ready for UI integration within the documented scope.
UI worktree is independent. Avoid edits there and main.

## Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|---|---|---|---|
| 261109-azt | Versioned read API, explicit tenant/project ACL, real overview, OpenAPI and UI handoff; domain10 + API12 and repeat new9 passed | 2026-11-09 | 45a9b51 | quick/261109-azt-versioned-director-api-tenant-project-ac |
| 261109-bkb | People/qualifications, immutable admission/current evidence, assignment/crews; OpenAPI30; independently verified 5/5, domain10/API26 + people14 repeat + tsc passed | 2026-11-09 | f1717a4 | quick/261109-bkb-people-qualifications-admission-checks-c |

## Confirmed decisions

- Backend uses isolated PostgreSQL54339, `.data/pg-54339`, API4327. Original UI defaults retained.
- Workers require active project membership plus actual employee assignment for project/task reads; own employee profile stays available without assignment.
- Missing quality/downtime/ID metrics are explicit unavailable/null. Legacy write limitations remain documented.
- No UI edits, main merge, deployment or complete-pilot readiness claim. Next: UI integration and task creation/readiness (02b).
- Backend02a uses durable atomic receipt/audit commands and ordered NO KEY UPDATE locks; current eligibility requires latest attempt/template and exact active qualification id/version on tenant civil date. Legacy task/sync admission enforcement remains02b pending.
- API4327 started from f1717a4; live health/OpenAPI30 and seeded director login/me/projects/employees/logout smoke passed after independent verification. Isolated PG54339 retained.
