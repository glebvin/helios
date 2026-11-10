## ISSUES FOUND

**Plan:** 261109-bkb / backend 02a. **After routine plan-only corrections:** 0 blockers, 1 warning. No implementation, app tests, migrations, commits or runtime commands were executed.

### Confirmed coverage

- All five must-have truths map to the three sequential tasks, artifacts and HTTP/PG verification. The 004 migration is now a separate must-have artifact.
- ACL-01/TEST-01/DEV-01 are claimed; PEOPLE-02A is explicitly a local trace label for the subsequent-people requirement. ROADMAP02b task readiness stays excluded.
- Contract covers employee/qualification/template/check/membership/assignment/crew routes, strict bodies, create-only expectedVersion=0, current eligibility versus immutable history, tenant/project visibility and director authority. Existing read fields stay additive; archived employees are terminal and assignments/crew participation are revoked with versions and audit.
- Composite tenant/resource FKs, FORCE RLS, immutable evidence/version checks, receipt conflict waiting and original-body replay, employee/project serialization and real concurrency assertions are specified.
- Structure checker actually ran: `node /Users/Gleb/.cursor/gsd-core/bin/gsd-tools.cjs query verify.plan-structure <PLAN>` returned valid=true, errors=[], warnings=[], three complete auto tasks. Independent prior path probe returned status=not_applicable for the three env-prefixed commands; it proves neither execution nor runtime path correctness.

### Plan defects corrected during review

1. **Lock order:** replaced ambiguous membership-before/after-employee language with receipt → sorted projects → sorted employees → sorted tenant memberships → assignments → project memberships → crew members. Commands skip unused classes and cannot acquire earlier classes later. Archive never takes project locks. Added link-edit/assignment, archive/activation and explicit/implicit-membership concurrency evidence.
2. **SQL privileges:** receipt reservation completion explicitly receives column-scoped UPDATE(status,result); identity/hash columns and DELETE are excluded. Immutable checks/template versions receive SELECT/INSERT only; mutable heads receive UPDATE. Audit remains append-only on this path.
3. **Version validation:** general positive-version rule now explicitly permits zero on the documented create-only PUTs.
4. **Migration ordering:** task1 applies003, therefore task2 uses004; assignment-check FK is created only after the check table. Removed the impossible option of extending003 after its tracer gate applied it.
5. **Archive regression:** explicitly require rejection of archived→active edits and activation after archive.

### Remaining warning

```yaml
issues:
  - plan: 261109-bkb
    dimension: scope_sanity
    severity: warning
    required_property: Execution remains reviewable and within one implementer context budget.
    description: Three tasks touch twelve files and task2 spans schema, admission, assignments, crews and concurrency; this exceeds the normal file-count comfort range.
    fix_hint: Keep the three existing sequential tracer checkpoints with exact recorded evidence and reload the contract at each checkpoint; split further if execution context becomes constrained.
```

The warning may be explicitly accepted by the orchestrator under the existing three-checkpoint structure. No unresolved correctness blocker remains in the reviewed plan. Runtime, type-check, HTTP/PG, deadlock, RLS and migration claims remain unverified until execution.
