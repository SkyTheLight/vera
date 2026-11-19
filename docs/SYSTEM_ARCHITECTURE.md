# V.E.R.A. — System Architecture

## 1. Project structure
```text
C:\Users\Skyth\Documents\vera\
├─ index.html                # App shell, metadata, font includes, root containers
├─ styles.css                # Design system, layout, components, responsive rules
├─ data.js                   # Seed entities and initial in-memory state
├─ app.js                    # Routing, rendering, UI interactions, domain logic
├─ README.md                 # Run/deploy/demo notes
├─ tests/
│  └─ unit.test.js           # Lightweight Node (node:test) unit checks for helpers/rules
└─ docs/
   ├─ APPLICATION_OVERVIEW.md
   ├─ FEATURE_SPECIFICATION.md
   ├─ TEST_PLAN.md
   ├─ TEST_CASES.md
   ├─ VERIFICATION_REPORT.md
   ├─ SYSTEM_ARCHITECTURE.md
   ├─ KNOWN_LIMITATIONS.md
   └─ evidence/
      ├─ 00-test-environment.txt
      ├─ 01-landing-initial-load.jpeg
      └─ 02-delivery-method-dropdown.jpeg
```

## 2. Frontend architecture
- **Type:** Single-page application (SPA) with hash-based client routing.
- **Entry point:** `index.html` loads `styles.css`, `data.js`, then `app.js` and provides mount/root elements (e.g. app container, modal/toast roots).
- **Rendering model:** `app.js` computes view HTML (template strings) based on `VERA_STATE` and route, mounts into DOM, and binds actions through `window.App` handlers (inline/event-driven calls) plus global listeners (`hashchange`, `load`, click handling for UI like notifications).
- **UI patterns:** application shell (header/nav/role switch), panels, tables/lists, key-value detail blocks, forms, tabs, badges/status indicators, timelines, modals (confirm/forms), toasts, and empty/conflict feedback states.
- **Styling:** centralized CSS variables/tokens and component classes in `styles.css` (restrained “operations console” design, responsive breakpoints/media queries).

## 3. Data and state management
- **Seed/state source:** `data.js` defines `window.VERA_SEED` and initializes `window.VERA_STATE` with entities:
  - `vehicles`, `customers`, `reservations`, `payments`, `maintenanceLogs`, `notifications`
  - session/UI fields (e.g. role/current customer/UI tab/modal/notification state)
- **Persistence behavior:**
  - Domain/application state is **in-memory** and resets on full page reload.
  - Role preference is persisted in `localStorage` (`vera_role`).
- **Mutation model:** UI actions call functions in `app.js` that directly mutate `VERA_STATE` arrays/objects, trigger notifications/toasts where relevant, and re-render.
- **Key reservation fields:** include identity/customer/vehicle refs, `start/end`, `actualReturn`, `status`, `totalFee`, `overtimeFee`, timestamps/actors/reasons/notes, and `deliveryMethod`.
- **Legacy compatibility:** `getDeliveryMethod(r)` returns `Not specified` when `deliveryMethod` is missing/empty, allowing older/legacy records to render safely.

## 4. Routing
- **Mechanism:** URL hash parsing (`location.hash`) with `hashchange` listener and route dispatch on load.
- **Examples:**
  - Customer: `#/customer/vehicles`, `#/customer/vehicle/:id`, `#/customer/reservations`, `#/customer/reservation/:id`, `#/customer/reservation/:id/pay`, `#/customer/notifications`, `#/customer/history` (and account-related view)
  - Admin: `#/admin/dashboard`, `#/admin/vehicles`, `#/admin/reservations`, `#/admin/reservation/:id`, `#/admin/payments`, `#/admin/maintenance`, `#/admin/reports`, `#/admin/customers`
- **Guards/behavior:** if no role selected, landing is shown; routes are scoped by role and redirected to role home when mismatched.

## 5. Main components/modules (logical)

### 5.1 Domain helpers (`app.js`)
- **Lookups:** `getVehicle`, `getReservation`, `getPaymentByReservation`, `getCustomer`, `currentCustomer`
- **Availability/conflicts:** `overlaps`, `hasConflict` (blocks `maintenance`/`malfunction` vehicles and conflicts with `approved`/`ongoing` reservations)
- **Pricing:** `computeFee` (`days = ceil`, min 1, `total = days*ratePerDay`), `computeOvertime` (`ceil` late hours × hourly rate)
- **Delivery method:** `DELIVERY_METHODS` constant, `getDeliveryMethod` (normalization/default for legacy)
- **Utilities:** date/formatting helpers, UID/toast/modal/notification helpers

### 5.2 Customer views
- Landing/role selection, vehicle list/detail, reservation list/detail, payment upload page, notifications, account/history.

### 5.3 Admin views
- Dashboard, vehicles, reservations (tabs/detail/actions), payments, maintenance/incidents, reports, customers.

### 5.4 Shared UI services
- Chrome/nav rendering, modal open/close/confirm flows, toast notifications, notification panel state.

## 6. Application workflows

### 6.1 Reservation creation (customer)
1. Customer selects vehicle and enters start/end dates and **Delivery Method**.
2. Client validates required fields, date order, delivery method membership, and availability/conflicts.
3. On success, creates `pending` reservation with computed total fee and `deliveryMethod`; adds admin notification; navigates to reservations.

### 6.2 Approval and payment
1. Admin approves/rejects pending request (rejection reason captured).
2. For approved reservation, customer may submit payment proof (local preview/in-memory record).
3. Admin verifies/rejects submitted payment proof.

### 6.3 Rental execution
1. Admin starts approved rental → reservation `ongoing`, vehicle `rented`.
2. Admin completes ongoing rental with actual return time → reservation `completed`, overtime computed/applied, vehicle returned to `available`, customer history/totals/notifications updated.

### 6.4 Maintenance/incidents
- Admin logs issues and resolves them; vehicle status/availability updates according to implemented rules.

## 7. Data relationships
- **Vehicle (1) — (many) Reservations:** `reservation.vehicleId`
- **Customer (1) — (many) Reservations:** `reservation.customerId` (plus denormalized name/email in records)
- **Reservation (1) — (0..1/many in data model, typically 1 active flow) Payment:** linked by `payment.reservationId`
- **Vehicle (1) — (many) Maintenance Logs:** `log.vehicleId`
- **Role/Customer — (many) Notifications:** `notification.role` (+ target/link metadata)

## 8. Technical dependencies
- **Runtime dependencies:** modern web browser with JavaScript enabled.
- **External resource (non-critical):** Google Fonts (Inter) via CDN links in `index.html` with system-font fallback.
- **Development/test tooling (optional, available in environment):** Node.js v24+ for syntax checks and `node --test` unit tests.
- **No package dependencies:** no npm modules required to run the prototype.

## 9. Notes on extensibility
- The current single-file `app.js` structure is appropriate for prototype scope but would benefit from modularization (domain/state/views) and stronger typing/tests if evolved toward production.
- Delivery method is modeled as a simple enumerated string field; future extensions (locations, instructions, fees) would require additional fields, validation, and UI/admin workflow updates (not currently defined).
