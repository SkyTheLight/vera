# V.E.R.A. — Feature Specification

## 1. Scope
This document specifies implemented and expected behavior for the V.E.R.A. interactive prototype, with emphasis on the **Delivery Method / Pickup & Return Configuration** feature integrated into the reservation workflow.

## 2. Feature descriptions

### 2.1 Core reservation and rental management (existing)
- Customers browse vehicles, view availability/conflicts, and submit reservation requests.
- Administrators review requests (approve/reject), verify payments, start rentals, and complete rentals.
- System tracks statuses, fees/overtime, notifications, maintenance, and basic reports.

### 2.2 Delivery Method / Pickup & Return Configuration (implemented)
Allows a customer to select how the vehicle will be handed over at pickup and return for a reservation request.

**Supported combinations (exact options):**
1. `Guest Pickup & Guest Return`
2. `Guest Pickup & Host Collection`
3. `Host Delivery & Guest Return`
4. `Host Delivery & Host Collection`

**Lifecycle coverage:** selection at booking → validation → stored in reservation record → visible in customer/admin views → preserved through status updates/transitions (approve, start/ongoing, complete, reject/cancel as applicable).

## 3. Functional requirements

### 3.1 Delivery Method
| ID | Requirement | Status |
|---|---|---|
| DM-FR-01 | Display a Delivery Method control in the customer reservation request form on vehicle detail pages where booking is allowed. | Implemented |
| DM-FR-02 | Present all four supported pickup/return combinations as selectable options plus a non-submittable placeholder prompt. | Implemented |
| DM-FR-03 | Allow the customer to select one preferred combination. | Implemented |
| DM-FR-04 | Require a valid delivery method before reservation submission (client-side validation). | Implemented |
| DM-FR-05 | Store the selected delivery method in the created reservation record (`deliveryMethod`). | Implemented |
| DM-FR-06 | Display the delivery method in customer reservation list and reservation detail views. | Implemented |
| DM-FR-07 | Display the delivery method in administrator reservation list and reservation detail views. | Implemented |
| DM-FR-08 | Preserve the delivery method value throughout the reservation lifecycle and status transitions. | Implemented |
| DM-FR-09 | Handle existing/legacy reservations without a delivery method without crashing; display `Not specified`. | Implemented |
| DM-FR-10 | Use existing V.E.R.A. UI patterns and remain responsive. | Implemented |

### 3.2 Reservation workflow (relevant existing requirements)
| ID | Requirement | Status |
|---|---|---|
| RES-FR-01 | Block submission when end date/time is not after start date/time. | Implemented |
| RES-FR-02 | Block submission when dates conflict with `approved`/`ongoing` reservations or vehicle is `maintenance`/`malfunction`. | Implemented |
| RES-FR-03 | Calculate estimated rental fee from duration and vehicle daily rate (`days = ceil`, minimum 1). | Implemented |
| RES-FR-04 | Support status transitions: `pending → approved|rejected|cancelled`, `approved → ongoing|cancelled`, `ongoing → completed`. | Implemented |
| RES-FR-05 | Compute overtime on completion when actual return is after scheduled end using contract tiers: 1h=P500, 2h=P800, 3h=P1,000, 4h+=P1,000+P500/hour after 3rd; >6h late charges one full-day rate (vehicle ratePerDay). Hours are rounded up. | Implemented |
| RES-FR-05A | Apply optional overtime add-ons: cleaning fee P200 and admin-entered refueling fee. Show breakdown lines (hours late, tier/base, cleaning, refueling, total/final charge). | Implemented |
| RES-FR-05B | Store overtime settings in `VERA_STATE.settings.overtime` (tiers, perHourAfterThird, fullDayAfterHours, cleaningFee) and show read-only admin "Rental Rules" panel. | Implemented |

## 4. Non-functional requirements
| ID | Requirement | Notes |
|---|---|---|
| NFR-01 | **Usability:** clear labels, placeholder prompt, helper hint, and actionable validation feedback. | Implemented within existing form style (`field-label`, `select`, `field-hint`, toast messages). |
| NFR-02 | **Consistency:** align with existing design system/components (panels, key-value rows, tables, badges, toasts). | Implemented. |
| NFR-03 | **Responsiveness:** usable on mobile and desktop layouts. | Existing responsive CSS retained; delivery field uses standard form controls. |
| NFR-04 | **Reliability:** no crashes for legacy records missing `deliveryMethod`. | Implemented via safe getter/default display. |
| NFR-05 | **Performance:** no unnecessary backend calls or heavy processing (client-only prototype). | No additional network logic added. |
| NFR-06 | **Maintainability:** minimal, localized changes preserving existing behavior. | Implemented. |
| NFR-07 | **Privacy/prototype safety:** no real PII/payment transmission or server storage introduced. | Preserved. |

## 5. User interactions

### 5.1 Customer — select delivery method during booking
1. Customer signs in as Customer and opens an available vehicle detail page.
2. Customer enters start and end date/time and selects a **Delivery method** option.
3. System shows fee preview/conflict feedback as applicable.
4. Customer clicks **Submit reservation request**.
5. On success, reservation is created as `pending` and customer is redirected to reservations with confirmation feedback.

**Validation feedback:**
- Missing/invalid delivery method: toast “Please select a delivery method.” and focus on the field (submission blocked).
- End before/at start: toast “End date must be after start date.” (submission blocked).
- Conflict/unavailable: inline conflict message and error toast (submission blocked).

### 5.2 Customer/Admin — view delivery method
- **Customer list:** reservation row shows `Delivery: <method>` (or `Not specified` for legacy).
- **Customer detail:** “Delivery method” shown in reservation details key-value section.
- **Admin list:** delivery method shown in period/details context for reservations.
- **Admin detail:** “Delivery method” shown in reservation details.

## 6. Business rules
- **Allowed delivery method values:** only the four specified combinations are accepted for new submissions.
- **Storage:** `reservation.deliveryMethod` stores the selected value as a string.
- **Legacy/default behavior:** if missing/null/empty, display as `Not specified` (no crash, no inferred value).
- **Lifecycle preservation:** delivery method is not modified by approve/reject/start/complete/cancel/payment verification actions.
- **No invented rules:** the application does **not** infer or enforce delivery/collection locations, special instructions, eligibility constraints, or additional fees based on delivery method because these are not defined in the existing application.

## 7. Expected system behavior
- A valid booking request includes vehicle, customer, period, computed fee fields, status/timestamps, and `deliveryMethod`.
- Users can identify the chosen pickup/return arrangement from customer and administrator reservation views.
- Existing seed and legacy-like records without `deliveryMethod` remain viewable and stable.
- Delivery method functionality does not break overlap checks, fee/overtime calculation, or status transitions.

## 8. Overtime contract rules (implemented)

- **Late definition:** actual return is after scheduled reservation end.
- **Hour rounding:** billable hours = `ceil((actualReturn-end)/1 hour)`; minimum billable late unit is 1 hour once late. **ASSUMPTION:** owner should confirm whether any grace period applies.
- **Tiers:**
  - 1 hour late: P500
  - 2 hours late: P800
  - 3 hours late: P1,000
  - 4 hours or more: P1,000 + P500 for each hour after the 3rd (4h=1,500, 5h=2,000, 6h=2,500)
  - More than 6 hours late: charge one full-day rate (vehicle `ratePerDay`) instead of hourly tier.
- **Optional add-ons (assessment):** cleaning fee P200, refueling fee (admin-entered amount). Add-ons are separate line items and included in final overtime charge.
- **Config:** `VERA_STATE.settings.overtime = { tiers:{1:500,2:800,3:1000}, perHourAfterThird:500, fullDayAfterHours:6, cleaningFee:200 }`.
- **UI:** admin completion modal shows breakdown preview; admin/customer reservation detail overtime panel shows hours late, tier applied, base, cleaning, refueling, final/outstanding. Admin dashboard shows read-only Rental Rules panel.

## 9. Future considerations (not implemented)
- Capture delivery/collection addresses and contact instructions per method.
- Define conditional required fields (e.g. address required for host delivery/collection).
- Configure and apply delivery/collection fees if business rules are approved.
- Add admin workflow prompts/checklists based on handoff method.
- Persist data and files via backend services in a production version.



## 11. Admin Live Map / Vehicle Tracking (simulated v1)

- **Scope:** Admin-only `#/admin/map` with sidebar/mobile nav entry "Live Map". Customers cannot open it.
- **Data:** `vehicle.tracker` `{ deviceId, enabled, lastSeenAt }` (legacy-safe default), `VERA_STATE.locationPings` `[{ vehicleId, reservationId, lat, lng, speedKph, recordedAt, source: 'simulator'|'tracker' }]`, `reservation.trackingConsent` `{ accepted:true, at }`.
- **Consent:** Booking form requires GPS tracking consent checkbox; submission blocked without it; consent stored on reservation and shown in reservation detail.
- **Map/list:** Leaflet + OpenStreetMap tiles (CDN, no API keys). One pin per vehicle with **ongoing** reservation. Click pin/row shows vehicle name/model/plate, renter, reservation ID, start, expected return, OVERDUE badge if `now > end`, last update, link to `#/admin/reservation/:id`. List panel beside map (stacks on mobile) with filters: All rented, Overdue.
- **No signal:** If no ping in last 15 minutes, vehicle shown greyed as "No signal".
- **Visibility/retention:** Locations shown only for ongoing reservations. Pings cleared when reservation completes; addPing rejects non-ongoing/out-of-period pings.
- **Simulator:** Admin "Demo simulator" toggle on map page. While on, every 5s adds a ping per ongoing enabled-tracker vehicle moving along Santo Domingo, Cainta, Rizal waypoints with interpolation/randomness. Page/pins labeled "Demo data (simulated)".
- **Integration point:** `addPing(ping)` validates lat/lng, vehicle/reservation match, ongoing status, rental period. Simulator calls it; future real tracker integration should call same function. No network code added.
- **Admin vehicle tracker field:** Vehicle modal/card includes device ID + enabled toggle + last seen.
- **Logging:** Map access and tracker/simulator enable-disable logged via `logActivity`.
- **Tests:** Pure helpers `getTrackedVehicles`, `isOverdue`, `isNoSignal`, `addPing` exposed on `window.App` for unit tests.

## 10. Landing page (prototype)
- `#/` renders a public landing/splash page for logged-out visitors and for logged-in users (no forced redirect).
- Logged-in users see **Continue to dashboard**; logged-out users see **Login** / **Sign up** routing to existing demo role-selection auth screens (`#/login`, `#/register`).
- Sections: hero, dismissible promo banner (in-memory), featured vehicles from `VERA_STATE.vehicles`, promo cards, demo sponsored/partner slots, how-it-works, requirements/pricing, FAQ, footer.
- Landing data is seeded in `data.js` as `VERA_STATE.landing = { featuredCount, promos, ads }`; promos with `validUntil` before Manila today are filtered out.
- Promos/ads are **display-only demo content**. No discount math, no promo code input, no change to `App.computeFee`.
- Featured vehicle cards use existing vehicle data and link to vehicle detail (existing login/role guard applies).
- Deposit is read from `App.getDepositAmount()`; overtime rules link uses existing overtime modal/settings.
- Assistant chat bubble is hidden on landing for logged-out visitors.
- Images are local under `images/landing/` (included in repo); missing images fall back to CSS gradient + emoji. No remote image hotlinking.

## 11. V.E.R.A. Assistant (customer chat, rule-based v1)

- **Scope:** Customer-only floating chat assistant for FAQs, availability checks, booking guidance, and navigation to key actions. Hidden for admin and landing/unauthenticated role.
- **Architecture:** Isolated `Assistant.respond(userText, context)` returns `{ text, chips?, actions? }`. v1 uses rule-based intent matching and small in-memory flow state; designed so an LLM can replace `respond()` later without touching UI.
- **Tools (allow-list):** `getRates`, `getRequirements`, `getDeliveryOptions`, `getOvertimeRules`, `checkAvailability`, `computeQuote`, `recommendByBudget`, `createReservation`, `navigateTo`, `highlight`. Actions are executed only through these tools.
- **Data sources:** Rates/vehicles/status from `VERA_STATE.vehicles`; requirements static prototype policy text; delivery options from `App.DELIVERY_METHODS`; overtime from `App.getOvertimeSettings()/VERA_STATE.settings.overtime`; availability/conflict from existing `hasConflict/overlaps`; fees from existing `computeFee/computeOvertime`; deposit from `App.getDepositAmount()` / `settings.depositAmount`.
- **Booking:** Collects vehicle, start/end, delivery method; shows summary with `computeFee` estimate; requires explicit "Confirm booking" tap; creates reservation through existing validation/creation path as **pending**; notifies admin; logs activity as `AI Assistant (for <customer name>)`. Assistant never approves, verifies payment, or releases vehicles.
- **Navigation:** `data-ai-target` attributes on key UI elements; `navigateTo` uses hash routing; `highlight` scrolls and applies temporary pulsing outline, retries briefly if element not rendered.
- **Budget mode:** Detects budget intent (Taglish supported, amounts like `5000`, `5,000`, `5k`, `₱5000`). Budget means **total cash out including refundable deposit**; response states this clearly and shows rental fee + deposit = total per option. If dates/days missing, assistant asks for them. Uses allow-listed `recommendByBudget(budget, start, end)` which internally uses existing availability/conflict and `computeFee` only; no fee math outside existing compute functions. Returns only AVAILABLE, non-conflicting vehicles where `total <= budget`, sorted by price ascending, max 5, each with "Book ..." action that prefills booking dates in-memory (`state.ui.bookingPrefill`) and navigates to `#/customer/vehicle/:id`; customer confirms manually. Assistant never auto-creates reservation from this flow. If nothing fits, suggests fewer days/smaller cc/different dates and never invents prices/availability.
- **Safety/validation:** customer role only; uses current customer data only; validates dates, past start, vehicle existence/status, conflicts, delivery method; unknown questions get capability response + chips; no invented policies; assistant errors are caught so normal UI keeps working.
- **UI:** floating button bottom-right (above mobile bottom nav), chat panel, message bubbles, typing indicator, quick chips, keyboard accessible (Esc closes, Enter sends). History in memory only.
