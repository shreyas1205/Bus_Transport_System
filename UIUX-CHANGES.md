# NaviGuard Master2 UI/UX polish

This Master2 package includes the previously added transport/safety features plus the UI/UX polish requested afterward.

## Included UI/UX changes
- Password Show/Hide text replaced by an accessible eye / crossed-eye icon.
- Reusable `Reveal.jsx` component using `IntersectionObserver`.
- Login hero, feature cards, quote, and login card reveal smoothly as they enter view.
- All six login feature cards are visible instead of hiding the last row.
- Sticky glass-style login header.
- Smooth page scrolling and refined scrollbars.
- Subtle page-entry animation for application pages.
- Refined hover/focus effects for cards, buttons, route rows, notifications, and navigation.
- `prefers-reduced-motion` support so accessibility settings disable nonessential motion.

No backend/database logic was changed for this UI/UX pass.

## Aurora Glass pass (30 Oct 2026) — palette switched to Midnight Teal (31 Oct)
- New palette (indigo → cyan gradient, mint success, coral danger) via tokens in `frontend/src/ui-polish.css`.
- Frosted-glass panels, sidebar, header, dialogs, dropdowns and map controls, with a gradient top hairline.
- Animated aurora background with a subtle dot grid.
- Micro-interactions: card lift, cursor spotlight, button ripple, light sweep, press-scale, input focus glow, pulsing danger dot, staggered page entrance, pop-in dialogs, hover icons in the nav.
- Gradient headings and scrollbar.
- Respects `prefers-reduced-motion`, falls back to solid panels without backdrop-filter, and uses lighter blur on phones.
- To revert, remove the 3 lines after `import './design-system.css';` in `App.jsx`.

## New login page (31 Oct 2026)
- `frontend/src/pages/Login.jsx` has a new layout and a new `Login.css`. The login logic is unchanged: real `login()`, 5 roles, the role-mismatch check, Remember Me, the destination for each role, Forgot Password and the Support dialog.
- Full-page bus photo (`frontend/public/naviguard-login-photo.jpg`, with the old UI removed). Hovering the bus pushes the camera in and lights the headlights.
- Midnight Teal glass card with a grain texture, floating labels, an animated border, a role grid with icons, all 6 feature cards and the quote.
- Previous version kept as `Login.jsx.backup-before-teal-login-2026-10-31`.
