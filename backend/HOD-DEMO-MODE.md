# Isolated HOD demo mode

Set NAVIGUARD_DEMO_MODE=true in the backend process environment when launching the demo separately. This implementation does not launch it or modify .env. Restart the backend to change modes; the flag is fixed at module initialization. Unset or false retains normal behavior. Invalid values fail startup.

Before Prisma initialization, demo mode requires DATABASE_URL to identify the local PostgreSQL database naviguard_hod_demo_20261020. Only localhost, 127.0.0.1 or ::1 are accepted, without query parameters or fragments. Other databases and remote hosts fail closed without logging the connection string. No database is created or seeded.

The HTTP server and its attached Socket.IO server bind to 127.0.0.1 in demo mode. Normal mode keeps its existing default binding. Demo clients must reach the backend on the same machine; a remote phone cannot connect directly.

Daily report scheduling, fee reminders, startup accident recovery and all automatic temporary-driver synchronization (including request-triggered synchronization) are disabled. Manual report generation remains local and never sends email.

Overpass lookup, emergency webhooks, SMTP, SMS, Razorpay and external college-directory lookup are blocked. There is no replacement identity or guardian approval. Existing authentication and explicit verified guardian links remain required. Password recovery cannot deliver external OTPs in demo mode.

Payment order creation, verification and sandbox fee payment return HTTP 403 with DEMO_MODE_BLOCKED before database access. Geocoding returns a clear error; route stops need explicit coordinates or a map URL containing coordinates. Missing, null and blank coordinates cannot become a fabricated zero location.

Local incident creation, confirmation, notifications and Socket.IO events remain active. Simulated dispatch uses the existing MOCK_DISPATCHED database enum, with code DEMO_MODE_BLOCKED and realEmergencyServiceContacted=false. No real resource lookup or dispatch occurs. GPS, trip start/end and vehicle location updates retain their existing authorization.

Run isolated scripts from backend with node tests/demo-mode.test.mjs. The accident-workflow and live-tracking scripts support NAVIGUARD_DEMO_MODE=true or false. Tests use synthetic data and mocks, not a listener or database. No live deployment validation was performed.
