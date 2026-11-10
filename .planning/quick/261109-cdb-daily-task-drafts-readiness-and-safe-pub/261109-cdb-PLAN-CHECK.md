# Backend02b — independent plan check

## ISSUES FOUND

**Plan:** 261109-cdb · **Source:** e34ce8e · **Checked:** 2026-11-09

**Severity counts:** BLOCKER **0** · WARNING **0** · INFO **1**.

Advisory only — no revision required. The plan is executable with its three sequential checkpoints; no unresolved conflict with the locked CONTEXT decisions was found. This is pre-execution plan analysis, not implementation verification.

## Coverage and invariants

| Requirement / invariant | Executable coverage | Result |
|---|---|---|
| API-01, DATA-01: actual project catalogs, daily plan/readiness and documented limitations | Task1 real zone/type records and exact plan fields; Task2 immutable versions/readiness/publication; Task3 actual OpenAPI and docs | Covered |
| ACL-01: tenant/project/role/own visibility | Interface role matrix; Task1 worker draft isolation including legacy views; Task2 fresh authority and linked-user checks; Task3 managed lineage fences | Covered |
| TEST-01, DEV-01 | All three checkpoints specify real HTTP/PG, explicit PG54339/API4327 environment, prior suites and tsc; Task2 deterministic races/rollback; Task3 full regression | Covered |
| CONTEXT D-01…D-10 | source_audit links every decision to concrete task actions; single assignee, no norms, unsupported prerequisites block, no execution/files/full-pilot claim | Covered |
| Project → employee → membership → task/assignment lock order | publication_protocol1–5: nonlocking hint, sorted old/new assignees and member IDs; stale hint abort without backward acquisition; archive path never acquires project | Covered |
| Fresh state after lock waits | Separate post-wait READ COMMITTED reads, current employee link/member/actor/responsible/project grants, same-client personnel evaluator; Task2 gate sequence tests stale member snapshots | Covered |
| Exact replay and cross-operation namespace | Receipt reservation before locks; explicit replay branch reauthorizes scope and never subsequently acquires employee locks; original body/status survives later invalidation; people/task mismatch and concurrent replay tests | Covered |
| Atomic publication and future qualification dates | Current exact admission plus inclusive validUntil >= workDate; latest failed front/template/catalog/planRevision; employee-serialized cross-project overlaps; post-write failure injection proves task/snapshot/receipt/audit rollback | Covered |
| Tenant/project FK safety | Existing task project/assignee composite FKs retained; new responsible membership and zone/type composite FKs explicit; Task2 front/task/template references, FORCE RLS and history grants | Covered |
| Published-plan/evidence immutability | Task2 DB protection for plan/lineage/snapshot reference and snapshot UPDATE/DELETE; cancellation retains plan/snapshot; catalog/personnel edits cannot rewrite historical evidence | Covered |
| Legacy creation and execution bypasses | Task3 service-level create410; lineage check before event replay/dispatch/report acceptance; all managed states blocked; deterministic legacy fixture preserves transaction/job/replay assertions | Covered |

AUTH-01 remains the completed earlier authentication slice, not a silently dropped new02b deliverable. ROADMAP has no per-phase requirement-ID list; the relevant REQUIREMENTS/PROJECT constraints above are claimed by plan frontmatter. Execution/offline/files/quality/material/ID/AOSR/full acceptance belong to later phases and are explicitly retained as pending.

All six must_haves truths have concrete actions and runtime verification obligations. Artifacts and key links connect controller/input → service → same-client personnel evaluation → SQL snapshot/receipt/audit, and managed lineage → legacy fences. One plan, wave1, depends_on=[], three sequential tasks: no missing dependency, cross-plan contract or same-wave coupling. No project .cursor/rules, .cursor/skills or .agents/skills directories, separate RESEARCH/PATTERNS or responsibility-map artifacts apply in this worktree.

## Mechanical validation and precise corrections

Only the plan-structure query was executed as a validation command; no application, test, migration, compilation, server restart or commit was run. Final `query verify.plan-structure` returned exit0, valid=true, errors=[], warnings=[], task_count=3; every task has Files/Action/Verify/Done. Task1's tracer type is accepted by the installed validator.

The supplied raw `/private/tmp/helios-02b-verify-paths.json` was consumed unchanged: status=not_applicable, blocker=0, warning=0, commands=3. Its verdict was not recomputed or inferred from the edited commands; not_applicable is not independent path certification.

Allowed point corrections applied only to PLAN:

- Replaced all three prose-bearing `<automated>` strings and semicolon chains with copyable shell commands: explicit DATABASE_URL/ADMIN_DATABASE_URL/HELIOS_DB_PORT/API_PORT and fail-fast `&&`. Materialized the repeated task suite and repeated migrations. Human inspections/preflight and measured evidence are separate `<manual>` assertions.
- Made the responsible-member and catalog composite FK requirements explicit; preserved existing project/assignee constraints and CONTEXT scope.
- The now-parseable Task3 command exposed a plan-structure R6 warning for bare `git diff --check` after committed checkpoints. Pinned its comparison to source `e34ce8e` so committed checkpoint changes and the current tree are covered; the final structure query has zero warnings.

## Advisory

The 17-file/3-task plan estimates58000 tokens at low confidence. This is a substantial execution session, but the checkpoints are coherent: catalog/draft, front/publication, then legacy fences/contract/regression. Preserve checkpoint commits and measured evidence, resume from completed checkpoints if context becomes tight, and retain all safety semantics. No additional decomposition or scope reduction is required by this check.

```yaml
issues:
  - plan: "261109-cdb"
    dimension: scope_sanity
    severity: info
    required_property: "Substantial sequential execution remains recoverable at its existing feature checkpoints."
    description: "The plan spans 17 files and three substantive tasks, with an estimate of 58000 tokens and low confidence; checkpoint boundaries and evidence requirements are already coherent."
    fix_hint: "Preserve the three checkpoint commits and measured handoff evidence; resume at the next checkpoint if needed without reducing safety coverage."
```

**Recommendation:** Execute the corrected plan sequentially; independently verify actual SQL locks, race outcomes, immutable snapshots, rollback and full regression afterwards. INFO alone does not block acceptance.
