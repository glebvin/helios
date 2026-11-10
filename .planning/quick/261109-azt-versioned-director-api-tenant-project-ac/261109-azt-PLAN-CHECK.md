# Plan check — 261109-azt

## ISSUES FOUND

**0 BLOCKER, 1 WARNING.** The proposed first read-API slice covers the six first-slice requirements and is technically executable. This is a plan review, not proof of implementation or runtime success.

### WARNING — scope_sanity

- **required_property:** A single execution plan stays within the GSD per-plan context/file budget.
- **evidence:** Three sequential tasks touch 13 distinct files. This exceeds the 10-file warning threshold, although it stays below the 15-file blocker threshold. Authentication, migration compatibility and authorization deserve concentrated review.
- **fix_hint:** Execute as three separately summarized/checkpointed tasks, or split the tracer/migration work from endpoint expansion and handoff. Retain the exact requirements and security boundaries; do not silently reduce them.
- **Budget probe:** `estimate-check --tokens 38000 --calibrated` returned 38,000 / 100,000 tokens, ratio 0.38, `over_budget: false`. Confidence is low, sample count 0; this is not a calibrated effort guarantee.

### Coverage and boundaries verified in the plan

| Requirement | Covering task(s) | Assessment |
|---|---|---|
| API-01 | 1–3 | Versioned project/employee/task/overview routes plus exact handoff contract |
| AUTH-01 | 2–3 | Validated login, session actor, expiry/revocation and single-session logout |
| ACL-01 | 1–2 | Forced tenant RLS plus explicit project predicates and own-worker filtering |
| DATA-01 | 2 | Independent real aggregates, timezone/day semantics and unavailable missing metrics |
| TEST-01 | 1–3 | Actual HTTP/PostgreSQL fixtures, forbidden access, bad inputs and repeated runs |
| DEV-01 | 1, 3 | Isolated port/data directory, documented startup and preservation of UI database |

Must-have truths are observable, artifacts are connected through controller/service/SQL/test/contract links, and every task supplies files, behavior/action, automated verification and a done condition. Tasks are sequential within one plan; there are no cross-plan dependencies or hidden parallel writers. New runtime dependencies, UI edits, primary-checkout edits, deployment, main merge and full-pilot claims are explicitly excluded.

The authorization policy does not trust client role headers; checks include active tenant/project membership, worker ownership, inaccessible-resource handling, totals and overview aggregates. Employee assignment is independent of tasks. Existing legacy mutation limitations are deliberately disclosed, not represented as fixed. The worker's own unassigned employee profile is an explicit exception to project-scoped reads; project/task reads still require assignment and membership.

### Verification-command status

The reported deterministic command-path probe returned `not_applicable` for all three environment-prefixed commands, with no blockers/warnings/readError. That is **not** execution success.

The earlier literal `&amp;&amp;` command-escaping issue is corrected in the reviewed on-disk plan: automated commands now contain raw `&&`; no `&amp;` remains. No application tests, migrations or PostgreSQL startup were run by this checker. Runtime evidence must be produced during execution against port 54339.

No project-local `.cursor/rules`, `.cursor/skills` or `.agents/skills` directories were present; the configured plan-checker skills query returned no additional skills. No CONTEXT.md or RESEARCH.md was supplied for this quick slice. Review stays limited to the declared first read API, not the complete customer pilot.
