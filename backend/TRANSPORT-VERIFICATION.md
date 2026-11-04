Parent transport access
=======================

Phone reconciliation proposes a student link; it does not verify guardianship.
Until a verified pair is explicitly configured, parent route, dashboard status,
vehicle and live-location reads return 403. Existing database links are preserved.

After independently verifying guardianship and account ownership, an operator can
set VERIFIED_GUARDIAN_LINKS to a JSON array of canonical user IDs and restart the
backend. Synthetic example:

VERIFIED_GUARDIAN_LINKS='[{"parentId":"parent-test","studentId":"student-test"}]'

Remove a pair to revoke access. A pair only works while ParentProfile.studentId
still matches and the linked account has role STUDENT. No pairs were configured
by this change. This is an explicit deployment configuration gate, not a completed
guardian verification UI or identity verification service.

Focused synthetic tests: node backend/tests/transport-selection.test.mjs
These mock Prisma and authentication; they do not establish live database or
browser success. GPS socket events now carry only refresh signals. Coordinates
are fetched through authorized HTTP reads.

Remaining access-control limitation: the shared unauthenticated Socket.IO server
still broadcasts location-bearing accident events (for example accident:possible
and accident:confirmed). Those features were explicitly excluded from this task
and were not changed. Overall access control must not be considered passed until
that separate broadcast authorization issue is resolved.

Modified files:
- backend/src/routes/transportSelection.js
- backend/src/routes/liveLocation.js
- backend/src/routes/routes.js
- backend/src/routes/vehicles.js
- backend/src/routes/boarding.js (parent dashboard read authorization only)
- frontend/src/pages/TransportSelection.jsx
- frontend/src/pages/LiveLocation.jsx
- frontend/src/pages/Dashboard.jsx

Added files:
- backend/src/services/parentTransportAccess.js
- backend/tests/transport-selection.test.mjs
- backend/TRANSPORT-VERIFICATION.md
