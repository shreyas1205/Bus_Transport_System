# NaviGuard Map Route + Fee Builder

## Admin route creation
1. Open **Admin → Routes**.
2. Choose **Build route on map**.
3. Click the map in travel order. Every click creates a numbered pickup point and the points are connected into a route preview.
4. Rename each point, set its planned arrival time, assign bus/driver and save.
5. The backend accepts the clicked latitude/longitude directly. A Google Maps link is generated automatically for every clicked stop.

## Fees after route creation
Route creation intentionally starts new stops with a fee of ₹0. Pricing can be finalized later.

1. Select a route in **Routes** and choose **Set fees for <route>**.
2. NaviGuard opens **Admin → Fee settings** with that route preselected.
3. Set a different annual fee for each pickup point and save it.
4. Existing fee logic updates unpaid fee records for users assigned to that pickup point. Paid records are preserved.

No Prisma schema migration is required for this feature because Stop already stores latitude, longitude, Google Maps URL and transportFee.
