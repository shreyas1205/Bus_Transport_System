# NaviGuard Master2 — Added Safety & Journey Features

This build keeps all features from the previous Autonomous Emergency build and adds the requested operational features without doing the planned UI/UX redesign.

## Added in Master2

1. Accident confirmation countdown
   - 30-second Driver countdown for lower-confidence accident detections.
   - Full Driver alarm/popup remains active.
   - If the Driver does not respond, Admin receives **Driver Not Responding** escalation.
   - The timeout alone does not contact external emergency services.
   - Existing high-confidence autonomous emergency flow is retained.

2. Route deviation alert
   - Uses live GPS versus the configured route polyline.
   - Driver and Admin receive warnings.
   - Deviation events are added to the live journey timeline.

3. Stale GPS warning
   - Default stale threshold: 90 seconds.
   - Live Tracking clearly shows how old the last GPS update is.
   - Admin/Driver receive throttled stale-GPS notifications.

4. Configurable overspeed warning
   - Each route now has `speedLimitKmph` (default 40 km/h).
   - Admin can change it from Routes & ETA.
   - Driver sees overspeed warning in Live Tracking.
   - Admin/Driver notifications are retained as event history.

5. Parent bus-approaching alert
   - Uses route `arrivalAlertMinutes` (default 10 minutes).
   - Linked Parent receives a persistent NaviGuard notification when the bus approaches the student's pickup stop.

6. Missed boarding detection
   - When the bus enters a pickup-stop geofence and later leaves it, NaviGuard checks assigned students at that stop.
   - If a student still has no boarding record for today, Parent and Admin receive **Student did not board today**.

7. Emergency information card
   - Confirmed crash information is shown in Admin SOS & Accident Center.
   - Includes bus, route, driver/contact, GPS, detection time, speed, onboard student count, selected police/hospital targets, and dispatch state.

8. Driver offline mode
   - Driver trip start/end, GPS, QR boarding, manual boarding and drop-off can be queued in `localStorage` when the network is unavailable.
   - Queue automatically syncs when connectivity returns.
   - GPS queue keeps the most recent unsent location to avoid unnecessary backlog.

9. Live journey timeline
   - Driver/Admin Live Tracking includes a timeline combining trip events, reached/passed stops, route deviations, overspeed warnings, boarding/drop-off events, and incidents.

## Existing autonomous emergency feature retained

High-confidence accident events still use the Autonomous Emergency Response module. In `demo` dispatch mode it selects nearby police/hospitals and simulates delivery. In `webhook` mode it can deliver the distress packet only to a configured authorized integration.

## Database update required

Master2 adds one Prisma field:

```prisma
Route.speedLimitKmph Float @default(40)
```

After replacing your project with Master2, run from `backend`:

```powershell
npx prisma db push
npx prisma generate
```

Then restart backend and frontend.

## UI/UX

The full UI/UX redesign and scroll/reveal effects were intentionally not added in Master2, per request. Only small functional warning/countdown/timeline elements required by these features were added.

## Final UI/UX polish
- Eye icon password visibility control on Login.
- Smooth scroll/reveal animation system using `frontend/src/components/Reveal.jsx`.
- Login hero/card/feature staggered reveals.
- All six login feature cards displayed.
- Sticky translucent login header, smoother hover/focus states, modern scrollbar.
- Lightweight page entrance effects across protected application pages.
- Reduced-motion accessibility support.


## Silent accident-level route deviation warning

When the Driver is detected off the assigned route, NaviGuard shows a full-screen accident-level visual warning without sound. The Driver can report the deviation as inevitable/unavoidable. NaviGuard then sends an Admin notification, emits a realtime event, keeps GPS tracking active, and records the action in the live journey timeline.


## Emergency Admin Pack
Confirmed accident alerts now include GPS/map link, affected student names, parent/guardian contact numbers, nearest police/hospital contact details when available, and explicit demo-vs-real dispatch status.

## Visual Map Route Builder + Deferred Pricing
- Admin can create a route by clicking pickup points directly on the OpenStreetMap map.
- Clicked points are numbered in route order and connected with a live polyline preview.
- Admin can undo/clear points, rename stops, edit coordinates and set planned arrival times before saving.
- New map stops are created with ₹0 fee by design; pricing can be finalized later.
- Selected routes include a **Set fees for route** shortcut to Fee settings.
- Fee settings accepts a route filter and shows every map-created pickup point for route-specific annual pricing.
- No Prisma schema migration is required.

## Temporary driver coverage
- Admin can schedule a verified replacement driver per route with start/end date-time and reason.
- Temporary driver automatically becomes the operational route driver at the start time.
- Regular driver is automatically restored at the end time.
- Admin can end active coverage early or cancel a scheduled replacement.
- Overlapping replacements are blocked and assignment history is retained.
- Route cards identify active temporary coverage.
