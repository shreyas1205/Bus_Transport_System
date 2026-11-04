# NaviGuard Temporary Driver Assignment

Admin can now keep a regular driver assigned to a route while scheduling a verified replacement for a limited period.

## Admin flow

1. Open **Routes & ETA** and select a route.
2. In **Driver Coverage → Temporary replacement driver**, select a driver whose license status is **VERIFIED**.
3. Set the start and end date/time and enter a reason (leave, emergency replacement, etc.).
4. NaviGuard activates the temporary driver at the start time and automatically restores the regular driver at the end time.
5. Admin can end an active assignment early or cancel a scheduled assignment.

## What changes while temporary coverage is active

- The temporary driver becomes the operational driver for the route.
- Driver route/GPS/boarding permissions follow the active route assignment.
- Parent/student route views show the current operational driver and temporary-coverage status.
- The original driver is preserved and restored automatically.
- Route-change history records activation, restoration and cancellation.
- Recent temporary assignments are visible in the Admin route page.

## Safety rules

- Only users with role `DRIVER` and `driverProfile.licenseStatus = VERIFIED` can be selected.
- Overlapping temporary assignments on the same route are blocked.
- Permanent reassignment is blocked while temporary coverage is active; end temporary coverage first.

## Database update

This version adds the `TemporaryDriverAssignment` model and `TemporaryDriverAssignmentStatus` enum. After copying your existing `.env`, run:

```powershell
npx prisma db push
npx prisma generate
```

No existing route, user, boarding, fee or notification records need to be deleted.
