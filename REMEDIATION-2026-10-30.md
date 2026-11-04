# NaviGuard Master2 — Remediation pass (30 Oct 2026)

None of the workflows, features, routes or screens changed. The fixes only tighten security and correctness. The checked-in audit
(`NAVIGUARD_AUDIT.md`, 25 Oct) had gone stale, and several of its items were already fixed. Each item below was checked against the current source.

## What was changed

| Audit # | Issue | Status | Where |
|---|---|---|---|
| 1 | Sandbox payment usable outside demo | Already fixed (verified) | `demoMode.js` `allowDemoPayment` |
| 2 | Unauthenticated / global realtime disclosure | Sockets already JWT-authenticated. **Fixed:** complaints (contact data) now go only to `role:ADMIN` + the owner, and `boarding:missed` (student names) goes only to admins, the route driver and notified parents | `routes/complaints.js`, `routes/liveLocation.js` |
| 3 | Parent changes phone → hijacks guardian link | Already fixed (parent phone is admin-only) | `routes/auth.js` |
| 4 | Driver escalates another bus's emergency | **Fixed:** the bus comes from the driver's active route (this includes temporary-driver assignments). A foreign `vehicleId` gets 403. Coordinates and sensor values are range-checked (lat ±90, lng ±180, speed 0–250, g 0–100, tilt 0–180). SOS now attaches the driver's bus automatically | `routes/incidents.js` |
| 5 | Offline queue loss/duplication | Already fixed (verified by tests) | `frontend/src/offlineQueue.js` |
| 6 | SQLite migration in a PostgreSQL project | **Fixed:** moved to `prisma/legacy-sqlite/`. The `db push` workflow stays. New `npm run db:baseline` generates a proper PostgreSQL baseline | `backend/prisma`, `backend/scripts/create-postgres-baseline.mjs` |
| 7 | Unsalted SHA-256 + 6-char passwords in admin user creation | **Fixed:** all three create paths use salted scrypt `hashPassword` and the shared 12-char policy. The bulk import transaction timeout was raised to fit the scrypt cost. The Users form now has `minLength` 12. The role-update hash leak was already fixed | `routes/users.js`, `pages/Users.jsx` |
| 8 | `/vehicles` exposes every bus; license data shown to riders | **Fixed:** Student/Staff/Parent see only their route's bus, a Driver sees only assigned buses, Admin sees all. License fields go to Admin/Driver only | `routes/vehicles.js`, `routes/liveLocation.js` |
| 9 | Concurrent duplicate GPS writes; GET side effects | **Fixed:** the GPS timestamp is claimed before any await, so a duplicate or older sample gets 400 (the claim rolls back if the write fails). The duplicate deviation/overspeed alerts were removed from GET because the GPS POST already raises them. The stale-GPS alert stays on GET because it can only be detected there | `routes/liveLocation.js` |
| 10 | Capacity −1 accepted; analytics double-counts | **Fixed:** capacity must be a whole number from 1 to 200 (create and edit), and odometer must be ≥ 0. `finalAmount` handles `baseAmount: 0` and legacy rows | `routes/vehicles.js`, `routes/dashboard.js` |
| 11 | CSV formula injection; localhost URLs | **Fixed:** cells starting with `= + - @ tab CR` are neutralised in both CSV exports. All sockets use one `SOCKET_URL` (same-origin by default) and Vite proxies `/socket.io` in every mode. ForgotPassword uses the shared `API_URL` | `Boarding.jsx`, `Users.jsx`, `socket.js`, 8 pages, `vite.config.js` |
| — | Tests failing on `emitEmergencyUpdate` / `verifiedParentStudent` | **Fixed:** the source was correct but the test harnesses were stale, so they were updated | `tests/accident-workflow`, `tests/boarding-workflow` |

New test: `backend/tests/remediation-regressions.test.mjs`. `npm test` was added to backend.

## How to run (unchanged + new helpers)
```
cd backend && npm install && npm run db:sync && npm run dev
cd frontend && npm install && npm run dev
cd backend && npm test
```
**Deployment note:** for production, serve the frontend and backend from one origin, or set `VITE_API_URL` / `VITE_SOCKET_URL` and `FRONTEND_URL` (CORS).

## Still open (needs your machine / real environment)
- Trip sessions are still held in memory (`tripSessions`), so a backend restart ends active trips. A persistent `Trip` table is the recommended next step.
- Live PostgreSQL integration run, field GPS on real phones, real Razorpay verification flow, and screenshots for the documentation appendix.
- Stale-GPS notification is still created from GET (deduplicated); moving it to a scheduled job would make GET read-only.

## Recommended UI changes (not applied — workflow-safe suggestions)
1. **Safety states first.** On Live Location and the Dashboard, put a clear status chip beside the bus: *Live · 12 s ago*, *Stale · 3 min*, *No trip*. Use amber for caution and red only for a confirmed SOS or accident. This keeps the "no false certainty" rule from your doc.
2. **Driver screen on mobile.** Give the driver trip page, SOS and boarding scan a one-handed layout: large bottom-anchored Start/End trip buttons and a press-and-hold SOS (about 1.5 s) so it can't be triggered by accident.
3. **Offline banner.** Show a top banner when the offline queue is not empty ("3 updates waiting to sync") with a retry button. Today the queue works silently.
4. **Form validation inline.** Show the new limits (capacity 1–200, password ≥ 12, coordinate errors) as messages under each field instead of only a toast after the server replies.
5. **Consistent styling.** Users, Dashboard and ForgotPassword have the most inline `style={{}}` blocks (15, 11 and 13). Move them into `design-system.css` tokens so light and dark mode and spacing stay consistent.
6. **Split the big pages.** `Boarding.jsx` (3.9k lines) and `Users.jsx` (1.8k) would be easier to maintain as sub-components (scanner, roster, export; create, bulk import, list). The UI stays the same.
7. **Empty and error states.** Riders now see only their own bus, so show "No bus assigned to your route yet — contact transport office" instead of an empty grid.
8. **Accessibility.** Live regions (`aria-live="assertive"`) for SOS and accident alerts, colour plus icon plus text for statuses, and 44 px tap targets on the map controls.
