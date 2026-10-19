# NaviGuard Emergency Admin Pack

When a confirmed/high-confidence accident activates emergency response, the Admin now receives:

- Exact GPS latitude/longitude and a Google Maps link.
- Affected student names and boarding/route status.
- Linked parent/guardian name and phone number for each affected student when available.
- Nearest police station name, phone (when published by the map provider), and distance.
- Nearest hospital name, phone (when published), and distance.
- Fallback emergency number (`EMERGENCY_FALLBACK_PHONE`, default `112`).
- Clear dispatch status. In the default DEMO mode, NaviGuard explicitly states that no real emergency service was contacted.

The Admin SOS & Accident Center also displays the affected student/parent contact list inside the Emergency Information Card.

No Prisma schema change is required.
