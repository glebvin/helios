# HELIOS — backend workstream

## Purpose
Implement the server-side pilot described in customer TZ 4.0 §19.2.
Owner is developing UI separately in cursor-ui. Work only in codex-api.

## Confirmed constraints
- NestJS + TypeScript, PostgreSQL, pg-boss; retain current foundation.
- No edits in apps/web or packages/ui. Existing HTTP contract remains compatible.
- Tenant and project access checked server-side, no invented production metrics.
- API contract and real HTTP/PostgreSQL tests are delivery artifacts.
- No production deployment, merge into main or changes to Cursor worktree.

## Sources
- PASSPORT.md
- Customer TZ 4.0, pilot §19.2 (owner supplied full text in conversation).
- /Users/Gleb/Documents/ChatGPT/sites/geotabel/helios-technical-review-2026-11-03/HELIOS — технический план и оценка первого этапа.md

## GSD execution
GSD Core 1.20.1 installed under ~/.cursor, read directly by Codex.
Host tool names adapted; no claim of invoking Cursor slash commands.
Planning is LOCAL to this linked worktree: create .planning before gsd-tools
so it does not resolve to /Users/Gleb/Helios. Already isolated; execute sequentially.
