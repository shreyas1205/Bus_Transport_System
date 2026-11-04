# NaviGuard — Consolidated Master Project

This is the consolidated master package for the NaviGuard college transportation platform. It merges the project versions built during this conversation into one project so you do not have to combine multiple ZIP files manually.

## Included features

### Access & accounts
- Password recovery by OTP when email/SMS delivery is configured
- Role-based login for Admin, Driver, Student, Staff and Parent
- Backend role verification
- Admin can create Driver, Student, Parent and Staff accounts
- Admin can edit Driver phone numbers
- AI-assisted bulk credential generation from a simple roster, including CSV export

### Transport operations
- Bus/fleet management
- Route creation and dynamic route reassignment
- Bus number and assigned driver
- Driver phone display
- Pickup point name, Google Maps URL, arrival time and fee
- Annual student route/pickup selection
- Route ETA and 10-minute browser notification
- Live bus location for Admin, Student and Parent

### Boarding & safety
- Parent boarding/drop-off notifications with unread status
- Daily student QR and driver route-restricted boarding
- QR/ID boarding scan
- Driver route roster with manual boarded/not-boarded checkbox
- Parent/student boarding status page with realtime Socket.IO updates
- Maintenance and SOS/incident management
- High-confidence GPS/sensor accident detection with global Driver alarm popup and repeating warning sound
- Autonomous nearby police / major-hospital selection using OpenStreetMap/Overpass
- Automatic distress-packet generation, Admin/Parent emergency alerts, and demo/authorized-webhook dispatch modes

### Student services
- Fees and payments
- Bus passes
- Complaints and admin responses/statuses
- Profile

## Important

The project intentionally stays on **Prisma 6.19.0**. Do not upgrade Prisma to an 8.x release candidate for this project.

## Setup

1. Extract this ZIP.
2. Open the project root in VS Code.
3. Start PostgreSQL with `docker compose up -d postgres` (or use an existing PostgreSQL instance).
4. In `backend`, run `npm install`, copy `.env.example` to `.env`, and replace the JWT/OTP secret placeholders with your own random values.
5. Run `npx prisma generate` and `npx prisma db push`.
6. For a fresh demo database only, run `npm run seed` (this deletes existing NaviGuard data).
7. Start the backend with `npm run dev`.
8. In a second terminal, go to `frontend`, run `npm install`, then `npm run dev`.

**Do not run `prisma migrate reset` or `npm run seed` against your existing NaviGuard database unless you intentionally want to replace/reset data.**

## Demo roles

Default demo accounts in the existing seed data use: `Pass@123`. Use the role selector on the premium login screen.

## Local URLs

- Frontend: `http://localhost:5173`
- Backend API: `http://localhost:4000`



## Autonomous emergency-response demo

High-confidence accident events can automatically activate the NaviGuard emergency-response engine without waiting for Driver/Admin confirmation. The backend selects nearby police stations and prioritizes hospitals using distance plus available emergency/capability metadata. It then builds a verified distress packet from NaviGuard data (bus, route, driver, GPS, speed change and onboard count).

By default `EMERGENCY_DISPATCH_MODE=demo`. In demo mode the project **does not contact real police, hospitals or ambulance services**; it records and displays simulated delivery targets. Production delivery must use an authorized emergency-dispatch integration. Set `EMERGENCY_DISPATCH_MODE=webhook` and configure `EMERGENCY_DISPATCH_WEBHOOK_URL` only when you have an authorized endpoint.

## Master2 additions

Master2 retains the autonomous emergency-response build and adds: a 30-second accident verification countdown with Driver-unresponsive Admin escalation, route-deviation warnings, 90-second stale-GPS warnings, configurable route speed limits and overspeed alerts, persistent Parent bus-approaching notifications, missed-boarding detection when a bus leaves a pickup stop, an Admin emergency information card, Driver offline queue/sync for trip/GPS/boarding actions, and a live journey timeline.

After upgrading an existing database to Master2, run `npx prisma db push` and `npx prisma generate` in `backend` because `Route.speedLimitKmph` is new.

The planned visual redesign, scroll reveal effects and wider UI/UX polish are intentionally deferred to the later UI pass.
