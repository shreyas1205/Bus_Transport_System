# Focused route and fleet change report

- ROUTE 3 DEACTIVATED: PASS (live database)
- CB-R1 PRESERVED: PASS (live database; Ravi Kumar assignment and KA-01-CB-101 unchanged)
- BUS DEACTIVATE: PASS (backend mocked tests; frontend application pending)
- BUS REACTIVATE: PASS (backend mocked tests; frontend application pending)
- SAFE BUS DELETE: PASS (backend mocked tests; no live bus deletion)
- ADMIN AUTHORIZATION: PASS (actual allow middleware exercised with mocked requests; authentication unchanged)
- FRONTEND STATUS UPDATES: NOT VERIFIED in browser; prepared JSX parses, but files could not be applied outside the writable backend directory.

## Live database change

Exactly one matching route was verified: West block / Route 3, ID cmule6z0u0002m8o8u11pvhm7. Only isActive was set to false. The transaction verified CB-R1 and KA-01-CB-101 were unchanged, Ravi Kumar remained assigned, and route/boarding/GPS/incident/route-change counts were unchanged. Read-only database checks verified exclusion using the student options, active count, driver assignment, and live routing filters.

No existing bus was changed or deleted. No reset or schema migration was run.

## Changed / added files

Applied backend:
- src/routes/vehicles.js
- src/routes/routes.js
- src/routes/liveLocation.js
- src/routes/boarding.js
- tests/fleet-status.test.mjs
- tests/boarding-workflow.test.mjs
- scripts/deactivate-route3.mjs (already executed successfully)

Prepared frontend replacements, NOT applied:
- pending-frontend/Fleet.jsx -> ../frontend/src/pages/Fleet.jsx
- pending-frontend/Routes.jsx -> ../frontend/src/pages/Routes.jsx

Documentation:
- ROUTE-FLEET-REPORT.md

## Finish frontend application

This session permits writing only inside backend. Review and copy the two prepared files into frontend/src/pages from a session with frontend write access. The Fleet replacement adds Admin-only controls, confirmation prompts, immediate React state updates after success, status badges, and server error display. The Routes replacement adds route activation/deactivation and filters bus choices to ACTIVE buses.

Restart the backend if it is not running in watch mode; refresh/rebuild the frontend after applying its files. Browser behavior is not yet tested. The esbuild check was blocked by spawn EPERM; Babel successfully parsed both prepared JSX files.

## Migration

None. prisma/schema.prisma has no VehicleStatus enum; Vehicle.status is already String with default ACTIVE. INACTIVE and BREAKDOWN require no schema change. MAINTENANCE is preserved for compatibility with the existing UI.

## Targeted tests

Passed:
- node tests/fleet-status.test.mjs
- node tests/transport-selection.test.mjs
- node tests/boarding-workflow.test.mjs
- node --check for the four changed backend route modules
- Babel JSX parsing of both prepared frontend replacements

Tests mock Prisma, requests, and sockets. Role tests use the actual allow middleware; they do not verify live login/token behavior. Bus deletion checks cover route assignments, GPS locations, services, incidents, boarding history, and route-change bus references. Empty-bus deletion was simulated only. Delete checks run under database table locks to prevent concurrent dependent records appearing between the checks and deletion; no cascade deletion is used by the endpoint.
