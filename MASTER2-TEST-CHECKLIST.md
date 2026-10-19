# NaviGuard Master2 Test Checklist

## Required setup

From `backend`:

```powershell
npx prisma db push
npx prisma generate
npm run dev
```

From `frontend`:

```powershell
npm run dev
```

## 1. Accident countdown

Simulate a lower-confidence sudden stop. Confirm the Driver receives the alarm popup and a countdown. Do not press either action. After 30 seconds, log in as Admin and verify **Driver Not Responding** notification exists.

## 2. Route deviation

Start a Driver trip and send GPS coordinates more than ~350m from the route line. Driver Live Tracking should display `ROUTE DEVIATION`; Admin should receive a notification.

## 3. Stale GPS

Stop sending Driver GPS updates for more than 90 seconds. Refresh Live Tracking. It should show GPS stale and the last-update age.

## 4. Overspeed

Admin > Routes & ETA > set the route speed limit to a low test value, e.g. 20 km/h. Send GPS speed above that limit. Driver should see OVERSPEED; Admin should receive an overspeed notification.

## 5. Parent approaching alert

Link a Parent to a Student with a pickup stop. Move the assigned bus close enough for ETA to be inside the route's configured alert threshold. Parent Notifications should contain `Bus approaching your pickup stop`.

## 6. Missed boarding

Start Driver trip. Enter a student's pickup-stop geofence, do not board that student, then send another GPS update outside the geofence. Parent/Admin should receive `Student did not board today`.

## 7. Emergency information card

Trigger/confirm a crash. Login as Admin > Incidents / SOS. The confirmed crash should show an Emergency Information Card with vehicle, route, driver, GPS, students onboard and selected emergency targets.

## 8. Offline mode

Start a Driver trip. Disable network, perform a boarding action and allow a GPS update. Re-enable network. The top banner should show queued actions syncing. Verify the boarding record/GPS reaches the backend.

## 9. Journey timeline

During a trip, perform boarding and GPS actions. Open Live Tracking as Driver/Admin and verify the timeline shows Trip started, stop/boarding events and warnings in timestamp order.
