# V.E.R.A. — Application Overview

## 1. Application purpose
V.E.R.A. (Vehicle Enterprise Rental Assistant) is a **web-based, interactive UI prototype** for managing car and motorcycle rentals for a single rental business. It demonstrates core rental workflows—vehicle browsing, reservation requests, approval/payment verification, rental start/completion, maintenance tracking, notifications, history, and basic reporting—in a clickable, thesis-defense-ready interface.

> **Prototype notice:** V.E.R.A. is not a production SaaS application. It does not provide real authentication, a backend server, a database, real payment processing, or server-side file storage.

## 2. Main objectives
- Prevent overlapping bookings for vehicles through availability/conflict checks.
- Present vehicle availability and rental status clearly to customers and administrators.
- Support the reservation lifecycle from request to completion (including cancellation/rejection paths).
- Track manual, out-of-system payment proof submission and administrator verification.
- Record maintenance/malfunction incidents and reflect vehicle availability impacts.
- Provide operational visibility (dashboard, reports, customer summaries, notifications).
- Demonstrate a configurable **Delivery Method (Pickup & Return)** selection as part of reservation creation and record-keeping.

## 3. Target users
| User role | Description | Access model (prototype) |
|---|---|---|
| **Customer** | Browses vehicles, checks availability, submits/manages reservations, uploads payment proof, views notifications/history/account. | Role selected on landing page; role preference stored locally (`localStorage` key `vera_role`). Demo customer context: `c1` (Juan Dela Cruz). |
| **Administrator** | Reviews/approves/rejects requests, verifies payments, starts/completes rentals, manages vehicles/maintenance, views reports/customers. | Role selected via landing/role switcher; local prototype state only. |

No staff role is implemented.

## 4. Customer functionality
- **Landing / role selection:** choose Customer or Administrator view.
- **Vehicle browsing:** list vehicles with search and filters; view type/status/rates/details.
- **Vehicle details & availability:** view specifications, availability/calendar context, overlap explanation, fee preview, and submit reservation request (when vehicle is available for booking).
- **Reservation creation:** select start/end date-time and **Delivery Method** (pickup/return combination), validate inputs, see conflict/fee feedback, submit pending request.
- **My Reservations:** view reservations by status/tab context, see delivery method, access details/actions.
- **Reservation details:** view status timeline, vehicle/period/fees/**delivery method**, payment status/proof info, and allowed actions (e.g. cancel pending, upload payment when approved).
- **Payment proof submission (simulated):** upload/select proof image for local preview and submit for admin verification (no server upload).
- **Notifications:** view reservation/payment/rental updates.
- **Account / rental history:** view profile summary and past/completed rental records.

## 5. Administrator functionality
- **Dashboard:** operational metrics, schedule/overview, and key indicators.
- **Vehicle management:** view/add/edit vehicle records and manage status (subject to prototype rules).
- **Reservation management:** review pending requests, approve/reject (with reason), view details including delivery method, start and complete rentals.
- **Payment verification:** review submitted proofs and verify/reject payments (with reason where applicable).
- **Maintenance & incidents:** log issues, track resolution, and restore/update vehicle availability as applicable.
- **Reports:** view basic operational summaries/earnings/utilization (including range toggles where implemented).
- **Customers:** view customer records and rental summaries/history.

## 6. Technology stack
| Layer | Technology |
|---|---|
| Application type | Single-page application (SPA), static prototype |
| Markup | `index.html` |
| Styling | `styles.css` (self-contained CSS design system; no CSS framework/build step) |
| Logic/UI | `app.js` (vanilla JavaScript) |
| Seed data/state | `data.js` (`window.VERA_SEED`, `window.VERA_STATE`) |
| Routing | Hash-based routing (e.g. `#/customer/vehicles`, `#/admin/dashboard`) |
| Persistence | In-memory state for domain data (resets on full reload); `localStorage` for role preference (`vera_role`) |
| External assets | Google Fonts (Inter) with system-font fallback; no external image assets required |
| Build/dependencies | None (no Node packages, no bundler, no compilation required to run) |

## 7. System architecture
- **Client-only, static delivery:** all files are served as static assets (`file://`, local HTTP server, or static hosting such as Vercel).
- **Data/state model:** `data.js` initializes seed entities (vehicles, customers, reservations, payments, maintenance logs, notifications). `app.js` reads/mutates `window.VERA_STATE` and re-renders views.
- **Rendering approach:** template-string HTML rendering into the app root with event handlers wired via `window.App` actions; modal/toast components for feedback and confirmations.
- **Domain rules (implemented in client logic):** overlap prevention for `approved`/`ongoing` reservations, vehicle status blocking (`maintenance`/`malfunction`), fee and overtime calculation, and controlled reservation status transitions.
- **Delivery Method integration:** stored per reservation (`deliveryMethod`), selected/validated at submission, displayed in customer/admin reservation views, preserved across lifecycle transitions; legacy reservations without the field display “Not specified”.

See `SYSTEM_ARCHITECTURE.md` and `FEATURE_SPECIFICATION.md` for details.

## 8. Application limitations
- No real user authentication/authorization or secure sessions.
- No backend, database, or persistent domain storage (data resets on refresh except role preference).
- No real payment gateway integration; payments/proofs are simulated/manual-verification UI only.
- No server-side file uploads or durable document storage.
- No automated CI/CD pipeline included in the repository; automated tests are lightweight and limited to available tooling (Node built-in test runner).
- Delivery/pickup/return **locations, instructions, and additional fees** are not defined in the existing application and are not implemented (documented as future considerations).
- Prototype behavior and validation are client-side only.

For a complete, honest breakdown, see `KNOWN_LIMITATIONS.md`.
