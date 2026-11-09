# Backend requirements

## First slice
- API-01: versioned documented read API for projects, employees, project tasks and actual daily overview.
- AUTH-01: validated individual login/session; current actor and logout.
- ACL-01: server-side tenant/project visibility, own data only for worker.
- DATA-01: no demo constants in new overview; unimplemented metrics explicitly unavailable.
- TEST-01: real HTTP/PG checks with two tenants and two projects plus denied roles and malformed input.
- DEV-01: isolated DB/ports for backend worktree; reproducible commands.

## Subsequent pilot slices
- People, qualifications/admission checklists, crews and project assignments.
- Daily tasks/readiness, shifts/downtime/reports and robust offline sync.
- Checklist versions, self/PTO/customer SC inspections, remarks/retries.
- 14 routes, authority registry and My tasks.
- Incoming materials, ID registry, AOSR, hold points and daily summary.
- Files, audit, MFA, backup/restore, load and complete acceptance tests.

First read API is not the complete pilot. Hardware/AI/BI/costing/1C/Bitrix/XML excluded.
