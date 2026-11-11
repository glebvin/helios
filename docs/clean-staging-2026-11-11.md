# Clean HELIOS staging, 11 November 2026

Requested by the owner: restore the established frontend, reset all active test data and credentials, and provide a simple separate login for every cabinet with one shared test password.

## Published state

- Public URL: https://helios-test.evegunina.ru/ .
- Runtime commit/image: `1658687e1422` / `helios-staging:1658687e1422`.
- Server current: `/opt/helios-staging/releases/1658687e1422`.
- Established frontend restored from `873b8bb`. Stylesheet is `index-wWfzokO7.css`; role/login changes produce JS `index-C4Xd2tv2.js`.
- Backend retains the newer time/execution API. Added only cabinet-role support, scoped read projections, and a server-side write denial for the additional read-only roles.
- Active database is a fresh `helios`, with a new tenant identifier, one company, one project, 13 users, and two employee cards (master/worker).
- No tasks, shifts, work reports, private files, invitations or time approvals were seeded.
- Evidence uses the fresh `helios-staging_clean_evidence_20261111` volume.
- Existing Cursor checkout `/Users/Gleb/Helios` was not changed by this work. Source is isolated in `/Users/Gleb/Documents/ChatGPT/sites/helios-role-staging-20261111`.

## Accounts

| Login | Membership role | Cabinet |
| --- | --- | --- |
| gd | gd | General director |
| ds | ds | Construction director |
| zds-sso | zds-sso | Construction service lead |
| zds-soso | zds-soso | Support service lead |
| rp | director | Project lead |
| master | master | Foreman |
| pto | pto | PTO lead |
| supply | supply | Supply |
| safety | safety | Occupational safety |
| hr | hr | HR |
| customer | customer | Customer |
| admin | admin | Administration |
| worker | worker | Worker |

The owner explicitly requested one simple shared password for this synthetic test environment. It is supplied separately in private access instructions, never in Git. Old email/password combinations are no longer active.

The nine additional cabinet roles currently have assigned-project reads in the established desk projection and no server writes except logout. Existing director/master/worker/PTO permissions remain separate. This does not implement unfinished HR, safety, administrative, quality or document approval processes. Existing browser-local demonstrations remain labelled as such. Returning the old frontend also returns its known API/UI integration limitations; it is a UI testing baseline, not acceptance of the complete operational pilot.

## Backup and switch

Before switching, only HELIOS API/worker were stopped briefly for a consistent DB/files snapshot and restarted. Backup:

`/opt/helios-staging/backups/before-clean-roles-20261111T130514Z`

The database dump was restored into a separate disposable database and all selected counts matched. Evidence tar restoration matched source SHA-256 hashes. The verification database was removed after that check.

Previous active counts: 12 users, 12 memberships, one project, ten employees, five tasks, three managed shifts, three managed reports, three private files, 13 invitations and three time approval revisions.

At cutover, the old database was renamed to `helios_archive_before_roles_20261111` and `ALLOW_CONNECTIONS false` was set. The verified candidate was renamed to the active `helios`. The closed old database and dump are recovery copies, inaccessible through the running app. Old evidence remains only in its previous detached volume and backup. No other project's database, containers, proxy routing or DNS were changed.

Rollback requires coordinated restoration of the previous release, DB name and previous evidence volume; changing only the application image is insufficient. The old environment/credentials are stored in the closed backup directory. Stop HELIOS API/worker, close active connections to its database, rename the new active DB aside, re-enable and rename the archive to `helios`, restore the backed-up environment/credentials and previous current release, and start only HELIOS API/worker/gateway. Do not run default development seed or `down -v`.

## Verification

- API/web TypeScript and production Vite build passed. The existing >500 KB JS chunk warning remains.
- Candidate DB: fresh migrations 001–012 applied, repeated migration pass. 13/13 login + exact membership role + desk + logout revocation checks passed.
- For all nine read-only roles, legacy event writes and v1 task creation returned 403.
- Public HTTPS: 13/13 new accounts login/desk/logout passed; three prior known credential pairs returned 401.
- Final counts: users 13, sessions 0; tasks/legacy shifts/reports/managed shifts/reports/private files/invitations/time approvals all zero after tests.
- Real browser on the public URL: 13/13 cabinets opened their expected first screen, with no development role switcher; screenshots and result JSON are private in `.data/browser-qa/`.
- HELIOS gateway/API/DB healthy; worker running. Other site's HTTPS `/api/health` returned 200.
- No complete workday, photo upload, quality acceptance, offline, physical-device or production-readiness claim is made.

Operational receipts on the VPS: `before-clean-roles-backup.json`, `clean-candidate-qa.json`, `clean-public-qa.json`. Private account manifest and current credentials remain mode 0600 outside release/web roots.
