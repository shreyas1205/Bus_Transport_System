# CampusBus — Consolidated Master Project

This is the consolidated master package for the CampusBus college transportation platform. It merges the project versions built during this conversation into one project so you do not have to combine multiple ZIP files manually.

## Included features

### Access & accounts
- Premium role-based login for Admin, Driver, Student and Parent
- Backend role verification
- Admin can create multiple Driver, Student, Parent, Staff and Fleet Manager accounts
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
- QR/ID boarding scan
- Driver route roster with manual boarded/not-boarded checkbox
- Parent/student boarding status page with realtime Socket.IO updates
- Maintenance and SOS/incident management

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
3. In `backend`, install dependencies and create `.env` from `.env.example`.
4. Run `npx prisma generate`.
5. Run `npx prisma db push` only when your PostgreSQL database is available.
6. Start the backend with `npm run dev`.
7. In a second terminal, go to `frontend`, run `npm install`, then `npm run dev`.

**Do not run `prisma migrate reset` or `npm run seed` against your existing CampusBus database unless you intentionally want to replace/reset data.**

## Demo roles

Default demo accounts in the existing seed data use: `Pass@123`. Use the role selector on the premium login screen.
