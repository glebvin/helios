# Backend state

Date: 2026-11-09
Branch: codex-api
Base: b2ddc9f
Current phase: 01 — first versioned read API.
Status: first v1 read slice implemented and locally verified; parent independent review pending.
UI worktree is independent. Avoid edits there and main.

## Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|---|---|---|---|
| 261109-azt | Versioned read API, explicit tenant/project ACL, real overview, OpenAPI and UI handoff; domain10 + API12 and repeat new9 passed | 2026-11-09 | 45a9b51 | quick/261109-azt-versioned-director-api-tenant-project-ac |

## Confirmed decisions

- Backend uses isolated PostgreSQL54339, `.data/pg-54339`, API4327. Original UI defaults retained.
- Workers require active project membership plus actual employee assignment for project/task reads; own employee profile stays available without assignment.
- Missing quality/downtime/ID metrics are explicit unavailable/null. Legacy write limitations remain documented.
- No UI edits, main merge, deployment or complete-pilot readiness claim. Next: independent review, UI integration, subsequent pilot modules.
