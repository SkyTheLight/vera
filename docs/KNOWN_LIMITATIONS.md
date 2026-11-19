# V.E.R.A. — Known Limitations

This document distinguishes **implemented**, **simulated**, **missing**, and **future** aspects of the V.E.R.A. prototype as verified in this workspace. It is intended to be honest and thesis-appropriate (prototype, not production-ready).

## 1. Implemented functionality (verified in prototype scope)
- Static, hash-routed single-page UI (`index.html`, `styles.css`, `data.js`, `app.js`) runnable via `file://` or static HTTP hosting.
- Role-based prototype views for **Customer** and **Administrator** (local role selection/persistence in `localStorage`).
- Vehicle browsing/detail views, availability/conflict feedback, and booking form for eligible vehicles.
- Reservation creation with validation (date order, availability/conflict, vehicle status blocking) and fee preview/calculation.
- **Delivery Method / Pickup & Return Configuration:**
  - Four selectable combinations: `Guest Pickup & Guest Return`, `Guest Pickup & Host Collection`, `Host Delivery & Guest Return`, `Host Delivery & Host Collection`.
  - Required selection and validation before submission (invalid/missing blocked).
  - Stored per reservation (`deliveryMethod`), displayed in customer/admin reservation lists and details, preserved across approve/start/complete lifecycle transitions.
  - Legacy reservations without `deliveryMethod` render safely as `Not specified`.
- Reservation lifecycle operations implemented in UI logic: approve/reject, start/ongoing, complete (with overtime calculation), and related status handling/cancellation paths as designed.
- Admin/customer pages for reservations, payments (manual verification workflow UI), maintenance/incidents, reports, notifications, and customer/history views (prototype behavior).
- Lightweight automated unit tests for selected helpers/business rules via Node built-in test runner (`tests/unit.test.js`).

## 2. Simulated functionality
- **Authentication/identity:** no real accounts or secure login; role is a UI selection (demo customer context used).
- **Persistence:** domain data is in-memory seed state and resets on full page reload (except `vera_role` in `localStorage`).
- **Payments:** payments occur outside the system; app simulates proof upload (local preview/object URL) and manual admin verification only.
- **File storage:** payment proof images are not uploaded to a server; previews/records exist in browser memory/state only.
- **Notifications/reports:** generated from client-side state changes and seed/demo data, not from backend services.

## 3. Missing functionality (current implementation)
- No backend server, database, or API layer.
- No real authentication, authorization, session management, or role enforcement on a server.
- No real payment gateway integration, receipts, or transaction reconciliation.
- No durable storage for reservations, users, vehicles, proofs, or logs across sessions/devices.
- No production-grade audit logging, monitoring, or security controls.
- No comprehensive automated E2E/CI pipeline in-repo (only lightweight unit tests and manual/browser-scripted verification performed).
- **Delivery-method-related details not defined/implemented:** pickup/delivery/return addresses, handoff instructions, conditional required fields per method, and any additional delivery/collection fees or business-rule branching (intentionally not invented).

## 4. Known technical/verification gaps
- **Native file upload E2E:** real OS file-chooser interaction for payment proof not fully automated/verified in this session (logic/UI previously exercised via simulation).
- **Visual evidence completeness:** only limited screenshot artifacts saved; not all required UI states/combinations captured as distinct named evidence images.
- **Cross-browser/device coverage:** not exhaustively tested on multiple browsers/devices or controlled viewport sizes; responsive behavior inferred from existing CSS and standard controls.
- **Performance/accessibility audits:** no formal profiling, load testing, or full accessibility conformance audit performed.
- **HTML/CSS external validation:** no third-party validator run in this environment (basic structural checks only).

## 5. Future improvements
- Define and implement delivery/collection **locations, instructions, and (if approved) fees** with appropriate validation and UI.
- Add backend services for authentication, authorization, persistence, and secure file storage.
- Integrate real payment processing/verification workflows where applicable.
- Expand automated testing (Playwright E2E, broader unit/integration coverage) and add CI quality gates.
- Modularize frontend architecture (separate domain/state/views), improve type safety, and strengthen accessibility/performance.
- Add audit trails, error monitoring, and production deployment/security hardening if moving beyond prototype scope.

## 6. Important disclaimer
V.E.R.A. is an **interactive prototype for demonstration and academic purposes**. Test results and implemented behaviors described in accompanying documentation reflect the current client-side prototype and its constraints; they must not be interpreted as evidence of production readiness, security hardening, or real-world transactional correctness.
