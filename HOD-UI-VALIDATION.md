# NaviGuard frontend redesign and repair

Implemented on 20 October 2026. Source changes are complete; production build and live visual/device acceptance remain unverified for the reasons below.

## Implemented

- Shared dark navy/electric blue design tokens, restrained glass surfaces, readable tables, consistent controls, responsive cards, focus rings and reduced-motion handling. Existing component CSS is placed in a foundation cascade layer, replacing competing `!important` rules with one shared design system. Small legacy text was raised to at least 11px.
- Login: redesigned hero, feature cards, five-role selector and form; removed credential prefills. Authentication, password visibility, Remember Me and role-specific destinations are retained. Password recovery uses the same theme with its existing API behavior.
- Support: accessible native dialog with validated name, email, topic and message. The request is downloaded as a local text draft. It explicitly says nothing is delivered and directs the user to share it with the college transport office. No support API was found, and no address was invented.
- Dashboard: shared glass cards, consistent summaries, stable route codes and readable assignment/ETA presentation. Existing data and route overview logic are retained.
- Routes: explicit View details dialog with ordered stops, bus, driver and ETA; Edit route settings navigates to supported safety settings. Pricing, temporary driver coverage and permanent reassignment retain their existing APIs. Permanent reassignment has confirmation; GPS refreshes no longer reset assignment/safety drafts. Invalid or missing route-builder coordinates are rejected instead of being treated as zero.
- Maps: reusable ResizeObserver integration invalidates existing Leaflet sizes, including panel/viewport changes. Route selection fits once per route; live tracking fits once per vehicle-set identity, preserving user pan/zoom through routine GPS updates.
- Tracking: separate active/stale/unavailable labels and a refresh-in-progress control. The serialized/coalesced background refresh behavior is preserved. Transient network failures retain the last snapshot; 401/403 clears protected snapshot data. Initial loading remains separate from routine updates.
- Boarding: shared responsive table, scanner, card, status and spacing treatment. QR verification, boarding/drop-off handlers and record logic were not changed.
- Fleet: route and driver assignments use `/routes` data joined by assigned bus ID; explicit unavailable/unassigned states, loading feedback and existing activation/deletion confirmations are retained.
- Fees: payment selection is hidden for no balance, missing records, loading or errors. Paid, pending and unavailable states are explicit. Payment actions retain the existing server endpoints and restrictions.
- Fee Settings: fixed the actual React hook-order crash. `useMemo` now runs before the loading return on every render. Added loading semantics, retry feedback, non-negative fee validation, responsive pricing/record layout and extracted component CSS.
- Maintenance: shared fleet/status/table design plus initial loading and load-failure states so unavailable data is not presented as healthy zero-count summaries.
- Navigation and role pages: independently scrolling sidebar without footer overlap; existing deduplication and role filtering retained; skip link, mobile Escape handling, focus containment and closed-menu inertness added. Notifications, search, profile, users, complaints, SOS, student, parent and staff pages receive the shared foundation/theme. Page-level error containment and a not-found route prevent opaque blank screens.

## Verified checks

All test files below passed when invoked directly with `node` from their respective frontend/backend directories. Tests use mocks or static/server rendering; these are not live database/browser/device acceptance tests.

Frontend:

| Test file | Coverage |
| --- | --- |
| `tests/ui-regressions.test.mjs` | 6 tests: all active JS/JSX/CSS parse and relative imports resolve; Fee Settings hook stability across loading/data/error; fee checkout visibility; all five role gates; map resize/refit behavior; empty login fields and five-role login/Remember Me arguments/destinations |
| `tests/demo-config.test.mjs` | 2 tests: demo API/socket isolation and elimination of port-4000 references in demo-transformed source |
| `tests/remember-me.test.mjs` | 5 tests: persistent/session storage, switching modes, logout and malformed cached user |
| `tests/live-location-refresh.test.mjs` | Initial load, background updates, burst coalescing, polling/socket events, permission errors, transient failures, refresh indicator and cleanup |
| `tests/dashboard-ui.test.mjs` | Syntax plus route codes, assignments and valid/unavailable ETA rendering |
| `tests/complaints-ui.test.mjs` | Student submission; admin filters/response editor; errors, dirty-draft preservation, socket refresh and navigation uniqueness |

Backend:

- `tests/demo-mode.test.mjs`
- `tests/boarding-workflow.test.mjs`
- `tests/complaints.test.mjs`
- `tests/live-tracking.test.mjs`
- `tests/fleet-status.test.mjs`
- `tests/fleet-ui.test.mjs`
- `tests/transport-selection.test.mjs`
- `tests/accident-workflow.test.mjs`
- `tests/autoLinkGuardians.test.mjs`

Two existing test harness defects were repaired: Fleet UI referenced obsolete staging files instead of active frontend files; guardian authorization testing assumed a fixed middleware index and did not await the middleware chain. Backend application authorization was not changed.

Useful commands, from `frontend`:

```powershell
npm run check:ui
npm run check:demo
node tests/live-location-refresh.test.mjs
node tests/remember-me.test.mjs
node tests/complaints-ui.test.mjs
node tests/dashboard-ui.test.mjs
npm run build
```

## Blocked validation and limitations

- `npm run build` was attempted. Vite failed loading its config because launching esbuild returned `spawn EPERM` in this restricted environment. No successful production bundle is claimed.
- The multi-file `node --test` runner also hit child-process `spawn EPERM`. Individual test files ran successfully via direct `node` invocation.
- Browser inspection of the existing `http://localhost:5173/profile` tab was denied by the browser origin permission gate. No alternate browser or indirect inspection was attempted. Screenshots, pixel layout, actual tile downloads and interactive browser behavior are therefore unverified.
- Existing route API supports creation, activation, optimization, safety settings, pricing and reassignment, but not general route-name/stop editing. The UI exposes supported actions and explains that limitation in route details.
- Support requests remain local downloads; there is no configured delivery workflow.
- No new real-device GPS, camera scan, payment, password-reset, emergency dispatch, email or SMS action was performed.

## Manual acceptance before the HOD demonstration

1. Check desktop, tablet and narrow mobile layouts, especially sidebar, topbar/search, fee records, route builder, roster and licence tables. The cascade consolidation affects every page and needs visual review.
2. Test five-role login with existing credentials, role mismatch, password visibility, Remember Me and Forgot Password under the established demo restrictions.
3. Open support; confirm field validation, Escape/focus behavior and a correctly labeled local request download.
4. As Admin, open Fee Settings, use a route filter, inspect loading/error handling and verify any authorized fee edits against existing records.
5. Verify Student complaint submission and Admin response; generate a daily Student QR; scan it as Driver; drop off; compare Admin boarding records.
6. Recheck Samsung Driver GPS sharing and Parent live tracking. Watch multiple background updates, a brief connection interruption, stale/unavailable GPS, manual refresh, map resizing and route selection.
7. Confirm live fleet assignments and supported route actions with existing records. Do not perform destructive changes solely for demonstration validation.
8. Inspect paid/no-fee/pending screens and ensure demo restrictions reject disallowed payment operations. Do not activate real payment or emergency delivery services.
9. Run a production build in an environment that permits esbuild subprocesses.

## Modified/new files

All paths are relative to the repository root:

| File | Change |
| --- | --- |
| `frontend/package.json` | Added `check:ui` script |
| `frontend/src/App.jsx` | Theme import and not-found route |
| `frontend/src/styles.css` | Foundation layer, removal of conflicting importance flags, readable minimum legacy type |
| `frontend/src/design-system.css` | New shared tokens, surfaces, responsive layouts and accessibility styling |
| `frontend/src/components/Layout.jsx` | Error boundary, skip link, mobile navigation accessibility, actual online indicator |
| `frontend/src/components/Dialog.jsx` | New accessible native dialog |
| `frontend/src/components/SupportDialog.jsx` | New validated local support-request workflow |
| `frontend/src/components/MapViewport.jsx` | New resize and stable-fit integration |
| `frontend/src/components/PageBoundary.jsx` | New page-level render-error recovery |
| `frontend/src/pages/Login.jsx` | Empty credentials, functional support and role accessibility |
| `frontend/src/pages/ForgotPassword.jsx` | Shared theme tokens; recovery behavior retained |
| `frontend/src/pages/Dashboard.css` | Foundation-layer integration and typography |
| `frontend/src/pages/Complaints.css` | Foundation-layer integration and typography |
| `frontend/src/pages/Routes.jsx` | Route details, supported editing access, map handling, draft preservation, coordinate validation and assignment confirmation |
| `frontend/src/pages/LiveLocation.jsx` | Stable viewport, GPS labels, refresh indicator and transient-error handling |
| `frontend/src/pages/Fleet.jsx` | Real route/driver joins and loading feedback |
| `frontend/src/pages/Fees.jsx` | Accurate payment availability and action guards |
| `frontend/src/pages/FeeSettings.jsx` | Hook-order crash fix, validation and retry feedback |
| `frontend/src/pages/FeeSettings.css` | Extracted foundation styles |
| `frontend/src/pages/Maintenance.jsx` | Loading and unavailable states |
| `frontend/src/pages/Users.jsx` | Extracted embedded directory styles |
| `frontend/src/pages/Users.css` | Directory foundation styles |
| `frontend/tests/ui-regressions.test.mjs` | New source/component regression tests |
| `frontend/tests/live-location-refresh.test.mjs` | Refresh indicator, explicit access-denial and transient-network regression coverage |
| `backend/tests/fleet-ui.test.mjs` | Test active source paths |
| `backend/tests/autoLinkGuardians.test.mjs` | Await actual authorization middleware chain |
| `HOD-UI-VALIDATION.md` | This implementation and validation handoff |

No database reset, seeding or mutation was performed. Credentials, JWT secrets, environment files, backend application code and demo restrictions were not changed. No commit or push was performed. The supplied workspace has no Git repository metadata, so a Git diff/status baseline was unavailable.
