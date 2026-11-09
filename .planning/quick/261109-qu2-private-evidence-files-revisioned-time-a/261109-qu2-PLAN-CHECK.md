# ISSUES FOUND — 03b-server plan (advisory only)

Plan `261109-qu2-PLAN.md`, locked sibling CONTEXT, source `8294b79`, worktree `codex-api`.

**Remaining: 0 BLOCKER, 0 WARNING, 1 INFO. Advisory only — no revision required.** Ready for the three sequential implementation checkpoints; this certifies the plan, not implementation.

## Coverage

| Required property | Executable coverage |
|---|---|
| Private actual JPEG/PNG/PDF, both immutable targets, scoped access | Task1 six routes, strict metadata/stream limits, magic/size/digest, composite event actor/request and report FKs, FORCE RLS/narrow grants |
| Durable ready bytes, immutable retries and honest FS/PG failure boundary | Task1 exclusive temp/fsync/no-clobber promotion, existing-byte verification, one ready/audit, private orphan reuse without shared deletion, failure/abort/concurrency tests |
| Current authority after waits and I/O, shared command compatibility | Tasks1–2 shared receipts, project/employee/sorted membership NO KEY UPDATE order, fresh post-I/O checks, current replay checks, real PG gates |
| Exact revisioned source and manual correction history | Task2 civil clipping, canonical relevant hash, exact integer totals, DST bounds, immutable approval/revoke revisions and source preservation |
| Deterministic event relevance and no permanently unexportable recorded days | Task2 ledger version ordering and composite event identity, carry-in/boundary flags, zero-duration markers; closed recorded zero-time days can approve/export zero totals |
| Complete coherent actual XLSX with fresh export ACL | Task2 one captured source/revision snapshot, missing/stale/revoked rejection, post-render current authorization, typed/XML-safe strings, independent ZIP/XML inspection |
| Retained contract/regression and delivery limits | Task3 old58+new11 operations, prior84 baseline tests retained, HTTP/PG/binary suites, API/domain checks;03c/04/production boundaries explicit |

All ten locked boundaries are addressed:1–4→Task1,5–9→Task2,10→all. Relevant PROJECT/REQUIREMENTS/ROADMAP scope is covered; existing authentication is reused. UI, queue/phone, authority workflow, 1C and deployment are expressly outside this slice. One exact pinned API XLSX writer is allowed; execution must inspect actual version/license/engines and record it, without broad package churn or service provisioning.

## Point fixes made in PLAN only

1. Removed the positive-only approval gate. The same recorded-day predicate now governs GET/approval/export; closed zero-duration in-day records are nonempty, hash their ordered markers and flags, and permit zero source totals. No-data days remain unapprovable, open records remain blocked.
2. Specified version-ordered interval-event lifecycle attribution for equal timestamps and composite tenant/actor/request identity. Request UUIDs and random segment UUID order cannot decide attribution.
3. Required download and attachment fresh authority after unlocked storage verification, and export fresh authority after rendering. Paused-I/O revocation tests now cover these; late source changes after export capture retain the documented attributable snapshot semantics.

These clarify locked nonempty-source, complete-export and current-authority requirements; they add no feature or architecture scope.

## Mechanical validation and limits

- GSD Core1.20.1 runtime identity confirmed. `query verify.plan-structure` exit0 before and after point fixes: valid=true, no errors/warnings,3 tasks with Files/Action/Verify/Done (one tracer, two auto).
- Three automated blocks pass `zsh -n` syntax checks. No assignments swallow failures or comparison/count gates merely recognize existing HEAD output; future test totals are additive expectations against the stated baseline.
- Supplied `/private/tmp/helios03b-verify-paths.json` consumed unchanged: not_applicable,0 blockers/0 warnings across3 commands. No path verdict was rederived.
- Single plan wave1, depends_on=[]; tasks execute1→2→3. Shared files are sequentially modified; no cross-plan graph, same-wave coupling or conflicting contracts.
- Calibrated estimate check:72000/100000 tokens, ratio0.72, over_budget=false; low confidence, calibration factor1/sample0. All22 declared files belong to these three checkpoints. Scope advice below preserves the expressly accepted three-checkpoint structure.
- No `.cursor/rules`, `.cursor/skills` or `.agents/skills` directories; configured checker skill query returned no entries. No sibling RESEARCH/PATTERNS artifacts: research resolution and pattern mapping not applicable. Registry/doc compatibility checks are explicitly execution work for the pinned writer.
- Static source consultation established existing event composite keys/version uniqueness and FK-compatible NO KEY UPDATE patterns; it did not certify implementation. No application, migration, install or test suite ran. No source/test/migration/package/commit changes made.

## Structured issues

```yaml
issues:
  - plan: 261109-qu2
    dimension: scope_sanity
    severity: info
    required_property: "Execution preserves the accepted three checkpoints without losing coverage as context grows."
    description: "22 files and an uncalibrated72000-token estimate make this a substantial quick plan; the locked context accepts three sequential checkpoints and fresh-context returns. All three tasks are complete and estimate is below the configured100000 budget."
    fix_hint: "Use the already-authorized checkpoint commits and evidence handoff to resume in fresh context when needed."
counts:
  blocker: 0
  warning: 0
  info: 1
```

**Recommendation:** Advisory only — no revision required. Execute sequentially, retain checkpoint evidence and obtain independent implementation verification before any03b-server completion claim.
